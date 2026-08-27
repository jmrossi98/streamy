/**
 * Email notification via the shared SNS topic.
 *
 * The same topic and conventions as scripts/alert.mjs, which does this for the
 * health check: one topic serves every project, and ALERT_PROJECT distinguishes
 * them in the subject. This is the in-app counterpart, for code that runs
 * inside Next rather than as a standalone script.
 *
 * Env (all shared with the health check):
 *   ALERT_SNS_TOPIC_ARN  target topic; notification is off when unset
 *   ALERT_PROJECT        subject prefix, default "streamy"
 *   AWS_REGION           default us-east-1
 *   plus standard AWS credentials
 */

const SUBJECT_LIMIT = 100;

export function isNotifyConfigured(): boolean {
  return !!process.env.ALERT_SNS_TOPIC_ARN;
}

/**
 * SNS rejects subjects containing newlines and truncates past 100 characters,
 * so both are handled here rather than discovered as a publish failure.
 */
export function formatSubject(text: string): string {
  const project = process.env.ALERT_PROJECT ?? "streamy";
  const oneLine = `[${project}] ${text}`.replace(/\s+/g, " ").trim();
  return oneLine.length <= SUBJECT_LIMIT ? oneLine : oneLine.slice(0, SUBJECT_LIMIT - 1) + "…";
}

/**
 * Publishes a notification. Returns whether it was sent.
 *
 * Never throws: a notification failing must not fail the check that produced
 * it. The caller records the returned value, so a change with `notified:false`
 * is visibly a change nobody was emailed about, rather than one silently
 * assumed delivered.
 */
export async function notify(subject: string, body: string): Promise<boolean> {
  if (!isNotifyConfigured()) return false;
  try {
    // Imported lazily, matching alert.mjs: the SDK is only needed when
    // alerting is actually configured.
    const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
    const client = new SNSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
    await client.send(
      new PublishCommand({
        TopicArn: process.env.ALERT_SNS_TOPIC_ARN,
        Subject: formatSubject(subject),
        Message: body,
      })
    );
    return true;
  } catch (err) {
    console.error("[notify] publish failed:", err);
    return false;
  }
}
