/**
 * Email alerting via a shared SNS topic.
 *
 * Deliberately project-agnostic: one topic serves every project, and the
 * project name goes in the subject line. Adding a new project is a publish
 * call, not another topic, another subscription, and another confirmation
 * email.
 *
 * Alerts fire on state *change* -- when something starts failing, and again
 * when it recovers -- rather than on every failing run. A check running every
 * six hours that mails on each failure sends ~28 emails during one bad week,
 * which is how alerting gets filtered to trash and stops working.
 *
 * Env:
 *   ALERT_SNS_TOPIC_ARN  target topic; alerting is off when unset
 *   ALERT_PROJECT        name used in the subject (default "streamy")
 *   AWS_REGION           default us-east-1
 *   plus standard AWS credentials
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const TOPIC_ARN = process.env.ALERT_SNS_TOPIC_ARN;
const PROJECT = process.env.ALERT_PROJECT ?? "streamy";
const REGION = process.env.AWS_REGION ?? "us-east-1";

export function isAlertingConfigured() {
  return !!TOPIC_ARN;
}

async function publish(subject, body) {
  // Imported lazily so the health check still runs everywhere when alerting
  // isn't configured and the SDK may not be installed.
  const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
  const client = new SNSClient({ region: REGION });
  await client.send(
    new PublishCommand({
      TopicArn: TOPIC_ARN,
      // SNS caps subjects at 100 chars and rejects newlines.
      Subject: subject.slice(0, 100).replace(/\s+/g, " "),
      Message: body,
    })
  );
}

async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // No state yet (first run, or the file was lost) -- treat as healthy so a
    // healthy first run doesn't announce a recovery that never happened.
    return { failing: false, failures: [] };
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Emails only when the failing/healthy state flips, or when a run is still
 * failing but for different reasons than last time -- a new failure appearing
 * during an existing outage is worth knowing about.
 *
 * Returns a short description of what it did, for the run log.
 */
export async function alertOnStateChange({ statePath, failures, summary, host }) {
  if (!isAlertingConfigured()) return "alerting not configured -- skipped";

  const previous = await readState(statePath);
  const nowFailing = failures.length > 0;
  const names = failures.map((f) => f.name).sort();
  const changed =
    nowFailing !== previous.failing ||
    JSON.stringify(names) !== JSON.stringify(previous.failures ?? []);

  await writeState(statePath, {
    failing: nowFailing,
    failures: names,
    updatedAt: new Date().toISOString(),
  });

  if (!changed) {
    return nowFailing ? "still failing, same causes -- no email" : "still healthy -- no email";
  }

  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  if (nowFailing) {
    const detail = failures.map((f) => `  - ${f.name}: ${f.detail}`).join("\n");
    await publish(
      `[ALERT] ${PROJECT} - integration check failed`,
      `Project:  ${PROJECT}\nHost:     ${host}\nWhen:     ${when}\n\n` +
        `FAILED (${failures.length}):\n${detail}\n\n${summary}\n`
    );
    return `emailed: ${failures.length} failure(s)`;
  }

  await publish(
    `[RESOLVED] ${PROJECT} - integration check passing`,
    `Project:  ${PROJECT}\nHost:     ${host}\nWhen:     ${when}\n\n` +
      `Previously failing:\n${(previous.failures ?? []).map((n) => `  - ${n}`).join("\n")}\n\n` +
      `All checks are passing again.\n\n${summary}\n`
  );
  return "emailed: recovery";
}
