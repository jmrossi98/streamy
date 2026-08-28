# Streamy infrastructure on AWS Lightsail, as code.
#
# This codifies what used to be a hand-clicked instance. The immediate reason it
# exists: the original box was a nano (512MB RAM), and running out of memory took
# the site down repeatedly. This provisions a right-sized instance and makes the
# whole thing reproducible -- an outage becomes `terraform apply`, not an hour of
# SSH recovery.
#
# It manages the instance, its firewall, daily snapshots, and the static IP
# attachment. It does NOT manage the app -- that still deploys via the existing
# GitHub Actions workflow over SSH. Terraform owns the box; CI owns what runs on
# it.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State is local by default (see README for the S3 backend option). The state
  # file can contain sensitive values, so it is gitignored and must never be
  # committed.
}

provider "aws" {
  region = var.region
}

# The application server.
resource "aws_lightsail_instance" "streamy" {
  name              = var.instance_name
  availability_zone = var.availability_zone
  blueprint_id      = "ubuntu_22_04"
  bundle_id         = var.bundle_id

  # Runs once on first boot: installs Docker + Compose and creates the deploy
  # directory the CI workflow expects. Kept minimal on purpose -- the app image
  # carries everything else.
  user_data = file("${path.module}/scripts/cloud-init.sh")

  # Daily snapshot: the backup that turns a dead box into a 10-minute restore
  # rather than a rebuild from memory.
  add_on {
    type          = "AutoSnapshot"
    snapshot_time = var.snapshot_time # UTC
    status        = "Enabled"
  }

  tags = {
    project = "streamy"
    managed = "terraform"
  }
}

# Firewall: only SSH, HTTP and HTTPS. Everything else is closed. Caddy needs 80
# and 443; 22 is for deploys and recovery.
resource "aws_lightsail_instance_public_ports" "streamy" {
  instance_name = aws_lightsail_instance.streamy.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
  }
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
  }
  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
  }
}

# Attaches the EXISTING static IP to this instance. The static IP
# (var.static_ip_name) was created outside Terraform and is left in place, so
# jakobrossi/streamy DNS never changes. Pointing this attachment at a new
# instance is what moves the IP during a migration -- Lightsail detaches it from
# the old box and attaches it here.
resource "aws_lightsail_static_ip_attachment" "streamy" {
  static_ip_name = var.static_ip_name
  instance_name  = aws_lightsail_instance.streamy.name
}
