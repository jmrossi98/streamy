# Streamy infrastructure (Terraform)

Codifies the AWS Lightsail box that runs Streamy. Terraform owns the **instance,
firewall, snapshots, and static-IP attachment**; the existing GitHub Actions
workflow still owns **deploying the app** over SSH.

This exists because the original hand-clicked `nano` (512 MB RAM) ran out of
memory and took the site down repeatedly. This provisions a right-sized box and
makes recovery `terraform apply` instead of an hour of manual SSH.

## What it manages

| Resource | Notes |
|---|---|
| `aws_lightsail_instance.streamy` | Ubuntu 22.04, `small_3_0` (2 GB) by default, first-boot Docker install + 2 GB swap |
| `aws_lightsail_instance_public_ports.streamy` | Firewall: 22, 80, 443 only |
| `aws_lightsail_static_ip_attachment.streamy` | Attaches the existing `StaticIp-1` so DNS never changes |
| Daily auto-snapshot | Backup + fast disaster recovery |

Not managed: the existing static IP object itself (created outside Terraform,
left in place), DNS, CloudFront, S3.

## Prerequisites

- Terraform >= 1.5
- AWS credentials with Lightsail permissions (the same account the AWS CLI already uses)
- Your SSH key (`~/.ssh/streamy_lightsail`)

## First-time setup

```bash
cd infra
terraform init
terraform plan     # review: it will CREATE a new instance named streamy-prod
```

`plan` creating a *new* instance is intentional — it stands the 2 GB box up
**alongside** the old `Ubuntu-1`, so migration is a clean cutover, not a
destroy-and-recreate of the live server.

## Migration runbook (nano -> 2 GB, zero data loss)

1. **Provision the new box:**
   ```bash
   terraform apply
   ```
   Note the `instance_public_ip` output — the new box's temporary IP (the static
   IP hasn't moved yet). Wait ~2 min for cloud-init (Docker install) to finish.

2. **Migrate data** (server `.env` + the SQLite volume) from old to new:
   ```bash
   OLD_IP=52.3.203.243 NEW_IP=<instance_public_ip> KEY=~/.ssh/streamy_lightsail \
     bash scripts/migrate-data.sh
   ```
   This briefly stops the app on the old box for a consistent copy.

3. **Move the static IP** to the new box. The attachment in `main.tf` already
   points at the new instance, so `terraform apply` (step 1) moved it — verify:
   ```bash
   terraform output static_ip   # should print 52.3.203.243
   ```
   DNS is unchanged because the IP itself didn't change; it just points at the
   new box now.

4. **Deploy the app** to the new box (it already has your data volume):
   ```bash
   gh workflow run deploy.yml
   ```
   `SERVER_HOST` is the static IP, so the deploy targets the new box
   automatically.

5. **Verify**, then **decommission the old box**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://streamy-app.com/api/health   # expect 200
   # once happy:
   aws lightsail delete-instance --instance-name Ubuntu-1
   ```

## Optional: remote state (S3)

Local state is fine for one operator. To make it durable/shareable, add a
backend block to `main.tf` (uncomment and fill in an S3 bucket you own):

```hcl
terraform {
  backend "s3" {
    bucket = "your-tf-state-bucket"
    key    = "streamy/infra.tfstate"
    region = "us-east-1"
  }
}
```

Then `terraform init -migrate-state`.

## Day-2

- **Resize later:** change `bundle_id`, re-run the migration runbook (Lightsail
  can't resize in place).
- **Recover a dead box:** `terraform apply` a fresh instance, restore the latest
  snapshot's data, move the static IP. Minutes, not an hour.
- **State safety:** `*.tfstate` is gitignored — it can contain sensitive values.
  Never commit it.

## Actual cutover (2026-08-28): snapshot-clone, not fresh provision

The nano→2 GB migration was done by **snapshot-cloning** the live box, not by
`terraform apply` of a fresh instance — a clone copies the whole disk (SQLite
data, `.env`, swap) with zero manual data migration, which was safer under
pressure. The steps taken (all via AWS CLI):

1. `create-instance-snapshot` of the old `Ubuntu-1`
2. `create-instances-from-snapshot ... --instance-names streamy-prod --bundle-id small_3_0`
3. `attach-static-ip StaticIp-1 streamy-prod` (moved the IP; DNS unchanged)
4. `open-instance-public-ports ... 443` — the clone's firewall reset to 22/80 only
5. verified, kept old box as a temporary fallback

The result matches this Terraform's defaults exactly (`streamy-prod`,
`small_3_0`, `us-east-1a`), so to bring the running box under Terraform
management, **import** rather than apply:

```bash
cd infra
terraform init
terraform import aws_lightsail_instance.streamy streamy-prod
terraform import aws_lightsail_static_ip_attachment.streamy StaticIp-1
terraform import aws_lightsail_instance_public_ports.streamy streamy-prod
terraform plan   # should show little/no drift; reconcile add_on/user_data if it does
```

Note: a snapshot clone won't have the cloud-init `user_data`, and `add_on`
auto-snapshots may need enabling to match. `terraform plan` will show any such
drift to reconcile deliberately.
