// Email system using Resend API only
let resend = null;
try {
  resend = require('resend');
} catch (_) {
  console.error('⚠️ Resend package not installed');
}

async function sendVerificationEmail(email, firstName, code) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; }
    .header { padding: 40px 40px 30px; text-align: center; background: #1a1a1a; }
    .logo { font-size: 28px; font-weight: 600; color: white; margin: 0; }
    .content { padding: 40px; }
    .title { font-size: 24px; font-weight: 600; color: #1a1a1a; margin: 0 0 16px; }
    .text { font-size: 16px; color: #666; line-height: 1.6; margin: 0 0 24px; }
    .code-box { background: #f5f5f5; border: 2px solid #e0e0e0; border-radius: 8px; padding: 24px; text-align: center; margin: 32px 0; }
    .code { font-size: 42px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; font-family: monospace; }
    .footer { padding: 24px 40px; background: #f9f9f9; text-align: center; color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="logo">Genovad</h1>
    </div>
    <div class="content">
      <h2 class="title">Welcome to Genovad, ${firstName}!</h2>
      <p class="text">Thank you for joining our construction services marketplace. To get started, please verify your email address using the code below:</p>
      <div class="code-box">
        <div class="code">${code}</div>
      </div>
      <p class="text">This code will expire in 24 hours. If you didn't create this account, please ignore this email.</p>
    </div>
    <div class="footer">
      <p>&copy; 2026 Genovad. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  if (!process.env.RESEND_API_KEY || !resend) {
    console.error(`❌ Resend not configured - Cannot send email to ${email}`);
    throw new Error('Email service not configured. Please set RESEND_API_KEY.');
  }

  try {
    const { Resend } = resend;
    const client = new Resend(process.env.RESEND_API_KEY);
    await client.emails.send({
      from: process.env.RESEND_FROM || 'noreply@genovad.com',
      to: email,
      subject: 'Verify Your Genovad Account',
      html: htmlContent,
      text: `Your Genovad verification code is: ${code}`
    });
    console.log(`✓ Verification email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error('Resend error:', error.message || error);
    throw new Error('Failed to send verification email');
  }
}

async function sendEmail(to, subject, htmlContent, fromEmail = null) {
  if (!process.env.RESEND_API_KEY || !resend) {
    console.error(`❌ Resend not configured - Cannot send email to ${to}`);
    throw new Error('Email service not configured. Please set RESEND_API_KEY.');
  }

  try {
    const { Resend } = resend;
    const client = new Resend(process.env.RESEND_API_KEY);
    await client.emails.send({
      from: process.env.RESEND_FROM || 'noreply@genovad.com',
      to: to,
      subject: subject,
      html: htmlContent
    });
    console.log(`✓ Email sent to ${to}`);
    return { success: true };
  } catch (error) {
    console.error('Resend error:', error.message || error);
    throw new Error('Failed to send email');
  }
}

module.exports = { sendVerificationEmail, sendEmail };
