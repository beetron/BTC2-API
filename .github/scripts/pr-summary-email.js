// Sends ONE email when a PR Review run finishes, saying whether every check
// passed, instead of GitHub's separate notifications. Run by the "Email
// summary" job in .github/workflows/pr-review.yml.
//
// Never fails the job: a missing secret or an SMTP error is reported as a
// warning on the run, so email problems can never turn a PR red.
//
// Inputs (environment):
//   JOB_RESULTS  toJSON(needs) from the workflow: { lint: { result }, ... }
//   PR_NUMBER, PR_TITLE, PR_URL, RUN_URL, HEAD_SHA
//   SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM  same SMTP account as the API
//   NOTIFY_EMAIL  who gets the email
//   DRY_RUN=1     print the email instead of sending it
import nodemailer from "nodemailer";

const env = process.env;

// Job ids in pr-review.yml, in the order they are listed in the email
const JOB_NAMES = {
  lint: "Lint",
  test: "Tests",
  audit: "Dependency audit",
  codeql: "CodeQL",
  semgrep: "Semgrep",
};

const warn = (message) => console.log(`::warning::${message}`);

const buildEmail =({ results, prNumber, prTitle, prUrl, runUrl, headSha }) => {
  const ids = [
    ...Object.keys(JOB_NAMES).filter((id) => id in results),
    ...Object.keys(results).filter((id) => !(id in JOB_NAMES)),
  ];
  const passed = ids.length > 0 && ids.every((id) => results[id]?.result === "success");

  const lines = ids.map((id) => {
    const result = results[id]?.result || "unknown";
    const label = result === "success" ? "PASS" : result.toUpperCase();
    return `${label.padEnd(9)} ${JOB_NAMES[id] || id}`;
  });

  // Titles are single-line on GitHub; strip line breaks anyway so a title
  // can never add lines to the email headers
  const title = String(prTitle || "").replace(/[\r\n]+/g, " ").trim();

  return {
    subject: `[BTC2-API] PR #${prNumber} checks ${passed ? "passed" : "FAILED"}: ${title}`,
    text: [
      passed ? "All checks passed." : "One or more checks did not pass.",
      "",
      ...lines,
      "",
      `Pull request: ${prUrl}`,
      `Run details:  ${runUrl}`,
      `Commit:       ${String(headSha || "").slice(0, 7)}`,
    ].join("\n"),
    passed,
  };
};

const main = async () => {
  let results;
  try {
    results = JSON.parse(env.JOB_RESULTS || "{}");
  } catch {
    warn("Summary email not sent: JOB_RESULTS is not valid JSON");
    return;
  }

  const email = buildEmail({
    results,
    prNumber: env.PR_NUMBER,
    prTitle: env.PR_TITLE,
    prUrl: env.PR_URL,
    runUrl: env.RUN_URL,
    headSha: env.HEAD_SHA,
  });

  if (env.DRY_RUN === "1") {
    console.log(`Subject: ${email.subject}\n\n${email.text}`);
    return;
  }

  const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "NOTIFY_EMAIL"].filter(
    (name) => !env[name]
  );
  if (missing.length > 0) {
    warn(`Summary email not sent, missing repository secrets: ${missing.join(", ")}`);
    return;
  }

  // Same transport settings as src/utility/sendEmail.js
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: env.NOTIFY_EMAIL,
      subject: email.subject,
      text: email.text,
    });
    console.log(`Summary email sent: ${email.subject}`);
  } catch (error) {
    warn(`Summary email could not be sent: ${error.message}`);
  }
};

await main();
