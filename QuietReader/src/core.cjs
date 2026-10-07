const iconv = require('iconv-lite');
const crypto = require('node:crypto');
const defaults = { fontSize: 22, lineHeight: 1.9, padding: 64, color: '#888888', background: '#212121' };
function decode(bytes, requested = 'auto') {
  if (!['auto', 'utf-8', 'gb18030'].includes(requested)) throw new Error('不支持的编码');
  let encoding = requested;
  if (encoding === 'auto') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); encoding = 'utf-8'; }
    catch { encoding = 'gb18030'; }
  }
  const text = iconv.decode(Buffer.from(bytes), encoding).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('文件包含二进制内容，请选择 TXT 文件');
  const replacements = (text.match(/\uFFFD/g) || []).length;
  return { text, encoding, warning: replacements > 0 ? '部分字节无法解码，请在阅读设置中切换编码。' : '' };
}
function paragraphs(text) {
  const result = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) { if (result.length) result[result.length - 1].gap++; continue; }
    result.push({ text: raw.replace(/^[\t \u3000]+/, '').replace(/\t/g, '    '), gap: 0 });
  }
  return result.map(p => ({...p, gap: Math.max(1, p.gap)}));
}
function identity(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function settings(input = {}) {
  const number = (key, min, max) => Number.isFinite(input[key]) ? Math.max(min, Math.min(max, input[key])) : defaults[key];
  return { ...(['songti','pingfang','kaiti','mono'].includes(input.mobileFont)?{mobileFont:input.mobileFont}:{}), fontSize: number('fontSize', 14, 40), lineHeight: number('lineHeight', 1.2, 2.8), padding: number('padding', 16, 240), background: /^#[0-9a-f]{6}$/i.test(input.background) ? input.background : defaults.background, color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : defaults.color };
}
function chapters(content) {
  const heading=/^(?:第[零〇一二三四五六七八九十百千万两\d]+[章回节卷部篇](?:\s|[：:、.．—-]|[^章回节卷部篇])?.*|(?:序章|序言|楔子|引子|前言|尾声|后记|终章|番外)(?:\s|[：:、.．一二三四五六七八九十\d]|$).*|chapter\s+\d+\b.*|prologue|epilogue)$/i;
  const result=[];
  for(let paragraph=0;paragraph<content.length;paragraph++){
    const title=content[paragraph].text.trim();
    if(title.length<=100&&heading.test(title))result.push({title,paragraph});
  }
  return result.length?result:[{title:'正文（未识别到章节标题）',paragraph:0}];
}
module.exports = { decode, paragraphs, identity, settings, defaults, chapters };
