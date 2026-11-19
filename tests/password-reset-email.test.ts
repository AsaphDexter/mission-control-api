import { describe, expect, it, vi } from "vitest";

import {
  buildPasswordResetEmailTemplate,
  buildPasswordResetLink,
  createPasswordResetEmailSender,
  type TransactionalEmail,
} from "../src/modules/auth/password-reset-email.js";

const RESET_TOKEN = "R".repeat(43);
const RESET_PAGE_URL = "https://mission-control.example/reset-password";

const SENDER = {
  email: "no-reply@example.test",
  name: "Mission Control",
};

describe("Password reset email templates", () => {
  it("creates both HTML and plain-text email content", () => {
    const content = buildPasswordResetEmailTemplate({
      firstName: "Amina",
      resetUrl: `${RESET_PAGE_URL}#token=${RESET_TOKEN}`,
    });

    expect(content.subject).toBe("Reset your Mission Control password");

    expect(content.htmlContent).toContain("Hello Amina");
    expect(content.htmlContent).toContain("Reset password");
    expect(content.htmlContent).toContain(RESET_TOKEN);
    expect(content.htmlContent).toContain("30 minutes");

    expect(content.textContent).toContain("Hello Amina");
    expect(content.textContent).toContain(RESET_TOKEN);
    expect(content.textContent).toContain("30 minutes");
  });

  it("escapes HTML in the recipient's first name", () => {
    const content = buildPasswordResetEmailTemplate({
      firstName: '<img src=x onerror="alert(1)">',
      resetUrl: `${RESET_PAGE_URL}#token=${RESET_TOKEN}`,
    });

    expect(content.htmlContent).not.toContain("<img src=x");
    expect(content.htmlContent).toContain("&lt;img");
    expect(content.htmlContent).toContain("&quot;alert(1)&quot;");
  });

  it("removes control characters from display names", () => {
    const content = buildPasswordResetEmailTemplate({
      firstName: "Amina\r\nBcc: attacker@example.com",
      resetUrl: `${RESET_PAGE_URL}#token=${RESET_TOKEN}`,
    });

    expect(content.textContent).not.toContain("\r");
    expect(content.textContent).not.toContain("\nBcc:");
    expect(content.textContent).toContain("Amina Bcc: attacker@example.com");
  });

  it("uses a URL fragment rather than a query parameter for the token", () => {
    const link = buildPasswordResetLink(RESET_PAGE_URL, RESET_TOKEN);

    const parsed = new URL(link);

    expect(parsed.origin).toBe("https://mission-control.example");
    expect(parsed.pathname).toBe("/reset-password");
    expect(parsed.hash).toBe(`#token=${RESET_TOKEN}`);
    expect(parsed.searchParams.has("token")).toBe(false);
  });

  it("rejects a token that does not match the opaque-token format", () => {
    expect(() => buildPasswordResetLink(RESET_PAGE_URL, "invalid-token")).toThrow("invalid format");
  });

  it("rejects insecure non-local reset URLs", () => {
    expect(() =>
      buildPasswordResetLink("http://mission-control.example/reset-password", RESET_TOKEN),
    ).toThrow("must use HTTPS");
  });

  it("allows HTTP for localhost development", () => {
    const link = buildPasswordResetLink("http://localhost:5173/reset-password", RESET_TOKEN);

    expect(link).toContain("http://localhost:5173/reset-password");
    expect(link).toContain(`#token=${RESET_TOKEN}`);
  });

  it("rejects reset URLs containing credentials", () => {
    expect(() =>
      buildPasswordResetLink(
        "https://user:password@mission-control.example/reset-password",
        RESET_TOKEN,
      ),
    ).toThrow("must not contain URL credentials");
  });

  it("rejects reset URLs containing an existing fragment", () => {
    expect(() =>
      buildPasswordResetLink(`${RESET_PAGE_URL}#existing-fragment`, RESET_TOKEN),
    ).toThrow("existing fragment");
  });
});

describe("Password reset email sender adapter", () => {
  it("maps the reset message into the provider-independent email transport", async () => {
    const transport = vi.fn(async (message: TransactionalEmail) => {
      expect(message.to[0]?.email).toBe("amina@example.com");
      expect(message.subject).toBe("Reset your Mission Control password");
    });

    const sendPasswordResetEmail = createPasswordResetEmailSender({
      resetPageUrl: RESET_PAGE_URL,
      sender: SENDER,
      transport,
    });

    await sendPasswordResetEmail({
      email: "amina@example.com",
      firstName: "Amina",
      token: RESET_TOKEN,
    });

    expect(transport).toHaveBeenCalledOnce();

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: SENDER,
        to: [
          {
            email: "amina@example.com",
            name: "Amina",
          },
        ],
        subject: "Reset your Mission Control password",
        htmlContent: expect.stringContaining("Reset password"),
        textContent: expect.stringContaining(RESET_TOKEN),
      }),
    );
  });

  it("rejects an invalid reset URL when creating the sender", () => {
    const transport = vi.fn(async () => undefined);

    expect(() =>
      createPasswordResetEmailSender({
        resetPageUrl: "not-a-valid-url",
        sender: SENDER,
        transport,
      }),
    ).toThrow("must be a valid absolute URL");
  });

  it("rejects an invalid sender email address", () => {
    const transport = vi.fn(async () => undefined);

    expect(() =>
      createPasswordResetEmailSender({
        resetPageUrl: RESET_PAGE_URL,
        sender: {
          email: "invalid-sender",
          name: "Mission Control",
        },
        transport,
      }),
    ).toThrow("sender address is invalid");
  });

  it("rejects invalid recipient addresses without calling the transport", async () => {
    const transport = vi.fn(async () => undefined);

    const sendPasswordResetEmail = createPasswordResetEmailSender({
      resetPageUrl: RESET_PAGE_URL,
      sender: SENDER,
      transport,
    });

    await expect(
      sendPasswordResetEmail({
        email: "invalid-recipient",
        firstName: "Amina",
        token: RESET_TOKEN,
      }),
    ).rejects.toThrow("recipient email address is invalid");

    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates provider delivery failures to the calling service", async () => {
    const transport = vi.fn(async (message: TransactionalEmail) => {
      void message;
      throw new Error("Email provider unavailable");
    });

    const sendPasswordResetEmail = createPasswordResetEmailSender({
      resetPageUrl: RESET_PAGE_URL,
      sender: SENDER,
      transport,
    });

    await expect(
      sendPasswordResetEmail({
        email: "amina@example.com",
        firstName: "Amina",
        token: RESET_TOKEN,
      }),
    ).rejects.toThrow("Email provider unavailable");

    expect(transport).toHaveBeenCalledOnce();
  });
});
