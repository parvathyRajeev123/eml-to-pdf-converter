const express = require('express');
const multer = require('multer');
const { simpleParser } = require('mailparser');
const puppeteer = require('puppeteer');
const sanitizeHtml = require('sanitize-html');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Keep uploaded files in RAM (max 25MB per file) for security & auto-cleanup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.originalname.toLowerCase().endsWith('.eml') ||
      file.mimetype === 'message/rfc822'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .eml files are supported.'));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Helper to escape plain text fields safely
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convert EML buffer into clean, styled printable HTML
async function buildEmailHtml(emlBuffer, options = {}) {
  const parsed = await simpleParser(emlBuffer);

  const from = parsed.from?.text || 'Unknown Sender';
  const to = parsed.to?.text || 'Unknown Recipient';
  const cc = parsed.cc?.text || '';
  const subject = parsed.subject || '(No Subject)';
  const date = parsed.date
    ? new Date(parsed.date).toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short'
      })
    : 'Unknown Date';

  let bodyHtml = '';
  if (parsed.html) {
    bodyHtml = parsed.html;

    // Replace inline CID attachments with Base64 data URLs
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        if (att.cid) {
          const base64 = att.content.toString('base64');
          const dataUri = `data:${att.contentType};base64,${base64}`;
          const cidRegex = new RegExp(
            `cid:${att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'gi'
          );
          bodyHtml = bodyHtml.replace(cidRegex, dataUri);
        }
      }
    }

    // Sanitize scripts and strip nested html/head/body tags that force 100% height
    bodyHtml = sanitizeHtml(bodyHtml, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'style', 'span', 'div', 'center', 'font'
      ]),
      allowedAttributes: false,
      allowedSchemes: ['http', 'https', 'mailto', 'data']
    });
  } else if (parsed.textAsHtml) {
    bodyHtml = parsed.textAsHtml;
  } else {
    bodyHtml = `<pre style="white-space: pre-wrap; font-family: sans-serif; margin: 0;">${escapeHtml(parsed.text || '')}</pre>`;
  }

  // Non-inline file attachments summary
  const regularAttachments = (parsed.attachments || []).filter(
    (a) => !a.cid || a.contentDisposition === 'attachment'
  );
  const attachmentsSection =
    regularAttachments.length > 0
      ? `<div class="attachments">
           <strong>Attachments (${regularAttachments.length}):</strong>
           <ul>
             ${regularAttachments
               .map(
                 (a) =>
                   `<li>${escapeHtml(a.filename || 'Unnamed file')} <span class="size">(${(a.size / 1024).toFixed(1)} KB)</span></li>`
               )
               .join('')}
           </ul>
         </div>`
      : '';

  const showHeaders = options.includeHeaders !== 'false';

  return {
    subject,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      box-sizing: border-box;
    }
    html, body {
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #1f2937;
      font-size: 14px;
      line-height: 1.5;
    }
    .print-wrapper {
      width: 100%;
      overflow: hidden;
    }
    .email-header-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .subject {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 12px 0;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    .meta-row {
      margin: 4px 0;
      font-size: 13px;
    }
    .meta-label {
      font-weight: 600;
      color: #475569;
      display: inline-block;
      width: 65px;
    }
    .attachments {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      font-size: 12px;
    }
    .attachments ul {
      margin: 6px 0 0 0;
      padding-left: 20px;
    }
    .attachments .size {
      color: #64748b;
    }
    .email-body {
      overflow-wrap: break-word;
      word-wrap: break-word;
      height: auto !important;
      min-height: 0 !important;
    }
    .email-body table,
    .email-body tbody,
    .email-body tr,
    .email-body td,
    .email-body div {
      min-height: 0 !important;
    }
    .email-body > *:last-child {
      margin-bottom: 0 !important;
      padding-bottom: 0 !important;
      page-break-after: auto !important;
      break-after: auto !important;
    }
    .email-body img {
      max-width: 100% !important;
      height: auto !important;
    }
  </style>
</head>
<body>
  <div class="print-wrapper" id="printWrapper">
    ${
      showHeaders
        ? `<div class="email-header-card">
            <h1 class="subject">${escapeHtml(subject)}</h1>
            <div class="meta-row"><span class="meta-label">From:</span> ${escapeHtml(from)}</div>
            <div class="meta-row"><span class="meta-label">To:</span> ${escapeHtml(to)}</div>
            ${cc ? `<div class="meta-row"><span class="meta-label">Cc:</span> ${escapeHtml(cc)}</div>` : ''}
            <div class="meta-row"><span class="meta-label">Date:</span> ${escapeHtml(date)}</div>
            ${attachmentsSection}
          </div>`
        : ''
    }
    <div class="email-body" id="emailBody">${bodyHtml}</div>
  </div>
</body>
</html>`
  };
}

// POST /api/convert - Converts single EML file to PDF
app.post('/api/convert', upload.single('emlFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload a valid .eml file.' });
  }

  let browser;
  try {
    const pageFormat = req.body.format || 'A4';
    const landscape = req.body.orientation === 'landscape';
    const includeHeaders = req.body.includeHeaders;

    const { html } = await buildEmailHtml(req.file.buffer, { includeHeaders });

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Remove 100%/100vh heights & trailing empty elements that trigger extra blank PDF pages
    await page.evaluate(() => {
      document.querySelectorAll('#emailBody *').forEach((el) => {
        const inlineHeight = el.style?.height || '';
        const inlineMinHeight = el.style?.minHeight || '';
        if (inlineHeight === '100%' || inlineHeight.includes('vh')) {
          el.style.height = 'auto';
        }
        if (inlineMinHeight === '100%' || inlineMinHeight.includes('vh')) {
          el.style.minHeight = '0';
        }
        if (el.getAttribute('height') === '100%') {
          el.removeAttribute('height');
        }
        if (el.style?.pageBreakAfter === 'always' || el.style?.breakAfter === 'page') {
          el.style.pageBreakAfter = 'auto';
          el.style.breakAfter = 'auto';
        }
      });

      const emailBody = document.getElementById('emailBody');
      while (emailBody && emailBody.lastElementChild) {
        const last = emailBody.lastElementChild;
        const hasMedia = last.querySelector && last.querySelector('img, hr, svg, table');
        const text = (last.textContent || '').replace(/\u00a0/g, '').trim();
        if (!text && !hasMedia && last.tagName !== 'IMG' && last.tagName !== 'HR') {
          last.remove();
        } else {
          break;
        }
      }
    });

    const pdfBuffer = await page.pdf({
      format: pageFormat,
      landscape,
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      }
    });

    const baseName = path.parse(req.file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).json({ error: err.message || 'Failed to convert EML to PDF.' });
  } finally {
    if (browser) await browser.close();
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`EML to PDF Converter running at http://localhost:${PORT}`);
});