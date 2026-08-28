variable "region" {
  description = "AWS region. The existing setup is us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "AZ for the instance. The existing box is in us-east-1a."
  type        = string
  default     = "us-east-1a"
}

variable "instance_name" {
  description = <<-EOT
    Lightsail instance name. Deliberately NOT the existing "Ubuntu-1": using a
    new name lets Terraform stand the new box up alongside the old one, so the
    migration is a clean cutover (move the static IP when ready) rather than a
    destroy-and-recreate of the live server.
  EOT
  type        = string
  default     = "streamy-prod"
}

variable "bundle_id" {
  description = <<-EOT
    Instance size. The old box was nano_3_0 (512MB) -- too little RAM, which is
    what caused the outages. Sizes (RAM / vCPU / disk / approx USD-mo):
      micro_3_0  = 1GB  / 2 / 40GB / $7
      small_3_0  = 2GB  / 2 / 60GB / $12   <- recommended, comfortable headroom
      medium_3_0 = 4GB  / 2 / 80GB / $24
  EOT
  type    = string
  default = "small_3_0"
}

variable "static_ip_name" {
  description = "Name of the existing Lightsail static IP to attach (keeps DNS stable)."
  type        = string
  default     = "StaticIp-1"
}

variable "snapshot_time" {
  description = "Daily auto-snapshot time, UTC HH:00. Default 06:00 UTC (~1-2am ET), off-peak."
  type        = string
  default     = "06:00"
}
