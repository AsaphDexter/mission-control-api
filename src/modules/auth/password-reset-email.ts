import type {
  PasswordResetEmailMessage,
  PasswordResetEmailSender,
} from "./password-reset-request.service.js";

export interface TransactionalEmailAddress {
  email: string;
  name: string;
}

export interface TransactionalEmail {
  sender: TransactionalEmailAddress;
  to: TransactionalEmailAddress[];
  subject: string;
  htmlContent: string;
  textContent: string;
}

export type TransactionalEmailTransport = (message: TransactionalEmail) => Promise<void>;

export interface PasswordResetEmailAdapterOptions {
  resetPageUrl: string;
  sender: TransactionalEmailAddress;
  transport: TransactionalEmailTransport;
}

export interface PasswordResetEmailTemplateInput {
  firstName: string;
  resetUrl: string;
}

export interface PasswordResetEmailContent {
  subject: string;
  htmlContent: string;
  textContent: string;
}

const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const EMAIL_SUBJECT = "Reset your Mission Control password";

function normaliseDisplayName(value: string): string {
  const cleaned = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return cleaned || "there";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}

function validateResetPageUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("PASSWORD_RESET_URL must be a valid absolute URL.");
  }

  if (url.username || url.password) {
    throw new Error("PASSWORD_RESET_URL must not contain URL credentials.");
  }

  if (url.hash) {
    throw new Error("PASSWORD_RESET_URL must not contain an existing fragment.");
  }

  if (url.searchParams.has("token")) {
    throw new Error("PASSWORD_RESET_URL must not contain a token query parameter.");
  }

  const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);

  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("PASSWORD_RESET_URL must use HTTPS, except for localhost development URLs.");
  }

  return url;
}

/**
 * Put the token in the URL fragment so browsers do not send it
 * in the HTTP request to the frontend server or include it in
 * ordinary server access logs.
 *
 * The frontend must read the token from window.location.hash.
 */
export function buildPasswordResetLink(resetPageUrl: string, token: string): string {
  if (!RESET_TOKEN_PATTERN.test(token)) {
    throw new Error("The password-reset token has an invalid format.");
  }

  const url = validateResetPageUrl(resetPageUrl);

  url.hash = new URLSearchParams({ token }).toString();

  return url.toString();
}

export function buildPasswordResetEmailTemplate(
  input: PasswordResetEmailTemplateInput,
): PasswordResetEmailContent {
  const firstName = normaliseDisplayName(input.firstName);
  const safeFirstName = escapeHtml(firstName);
  const safeResetUrl = escapeHtml(input.resetUrl);

  return {
    subject: EMAIL_SUBJECT,
    textContent: [
      `Hello ${firstName},`,
      "",
      "We received a request to reset the password for your Mission Control account.",
      "",
      "Use the link below to choose a new password:",
      input.resetUrl,
      "",
      "This link expires in 30 minutes and can only be used once.",
      "",
      "If you did not request a password reset, you can safely ignore this email.",
      "",
      "Mission Control",
    ].join("\n"),
    htmlContent: [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${EMAIL_SUBJECT}</title>`,
      "</head>",
      "<body>",
      '<main style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #202124; line-height: 1.6;">',
      `<h1 style="font-size: 24px;">Hello ${safeFirstName},</h1>`,
      "<p>We received a request to reset the password for your Mission Control account.</p>",
      "<p>Use the button below to choose a new password:</p>",
      `<p style="margin: 28px 0;"><a href="${safeResetUrl}" style="display: inline-block; padding: 12px 20px; background: #fe2d2d; color: #ffffff; text-decoration: none; border-radius: 6px;">Reset password</a></p>`,
      "<p>This link expires in 30 minutes and can only be used once.</p>",
      "<p>If you did not request a password reset, you can safely ignore this email.</p>",
      "<p>Mission Control</p>",
      "</main>",
      "</body>",
      "</html>",
    ].join(""),
  };
}

export function createPasswordResetEmailSender(
  options: PasswordResetEmailAdapterOptions,
): PasswordResetEmailSender {
  // Validate configuration when the adapter is created, not during delivery.
  validateResetPageUrl(options.resetPageUrl);

  if (!EMAIL_PATTERN.test(options.sender.email)) {
    throw new Error("The transactional email sender address is invalid.");
  }

  const senderName = normaliseDisplayName(options.sender.name);

  return async (message: PasswordResetEmailMessage): Promise<void> => {
    if (!EMAIL_PATTERN.test(message.email)) {
      throw new Error("The password-reset recipient email address is invalid.");
    }

    const resetUrl = buildPasswordResetLink(options.resetPageUrl, message.token);

    const content = buildPasswordResetEmailTemplate({
      firstName: message.firstName,
      resetUrl,
    });

    await options.transport({
      sender: {
        email: options.sender.email,
        name: senderName,
      },
      to: [
        {
          email: message.email,
          name: normaliseDisplayName(message.firstName),
        },
      ],
      subject: content.subject,
      htmlContent: content.htmlContent,
      textContent: content.textContent,
    });
  };
}
