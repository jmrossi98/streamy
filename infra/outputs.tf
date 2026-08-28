output "instance_name" {
  description = "Name of the provisioned instance."
  value       = aws_lightsail_instance.streamy.name
}

output "instance_public_ip" {
  description = "The instance's own public IP (before the static IP attaches)."
  value       = aws_lightsail_instance.streamy.public_ip_address
}

output "static_ip" {
  description = "The static IP now attached -- this is the address DNS points at."
  value       = aws_lightsail_static_ip_attachment.streamy.ip_address
}

output "ssh_hint" {
  description = "How to reach the new box during migration (before the static IP moves)."
  value       = "ssh -i <key> ubuntu@${aws_lightsail_instance.streamy.public_ip_address}"
}
