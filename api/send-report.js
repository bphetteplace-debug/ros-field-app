// api/send-report.js - Minimal test (CommonJS via api/package.json)
module.exports = async function handler(req, res) {
  return res.status(200).json({ ok: true, method: req.method, body: req.body })
}
