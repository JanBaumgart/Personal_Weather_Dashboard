export default function handler(req, res) {
  const key = process.env.OWM_API_KEY;
  res.setHeader('Cache-Control', 'private, no-store');
  if (!key) { res.status(404).json({ key: null }); return; }
  res.status(200).json({ key });
}
