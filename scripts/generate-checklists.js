const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function mdToPdf(mdPath, pdfPath) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const doc = new PDFDocument({margin: 50});
  doc.pipe(fs.createWriteStream(pdfPath));

  const lines = md.split(/\r?\n/);
  let yOffset = 0;
  lines.forEach(line => {
    if (!line) {
      doc.moveDown(0.2);
      return;
    }
    if (line.startsWith('# ')) {
      doc.fontSize(20).font('Times-Bold').text(line.replace(/^#\s+/, ''), {continued: false});
    } else if (line.startsWith('## ')) {
      doc.moveDown(0.2);
      doc.fontSize(14).font('Times-Bold').text(line.replace(/^##\s+/, ''), {continued: false});
    } else if (line.startsWith('### ')) {
      doc.fontSize(12).font('Times-Bold').text(line.replace(/^###\s+/, ''), {continued: false});
    } else if (line.startsWith('- ')) {
      doc.fontSize(10).font('Times-Roman').text('• ' + line.replace(/^-\s+/, ''), {indent: 10});
    } else if (line.startsWith('**') && line.includes('**')) {
      const text = line.replace(/\*\*(.*?)\*\*/g, '$1');
      doc.fontSize(11).font('Times-Bold').text(text);
    } else {
      doc.fontSize(11).font('Times-Roman').text(line);
    }
  });

  doc.end();
}

function main() {
  const exportsDir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  const files = [
    {md: 'social-integration-checklist.md', pdf: 'social-integration-checklist.pdf'},
    {md: 'instagram-checklist.md', pdf: 'instagram-checklist.pdf'},
    {md: 'facebook-checklist.md', pdf: 'facebook-checklist.pdf'}
  ];

  files.forEach(f => {
    const mdPath = path.join(exportsDir, f.md);
    const pdfPath = path.join(exportsDir, f.pdf);
    if (!fs.existsSync(mdPath)) {
      console.error('Missing file:', mdPath);
      return;
    }
    console.log('Generating', pdfPath);
    mdToPdf(mdPath, pdfPath);
  });

  console.log('Done. PDFs written to', exportsDir);
}

main();
