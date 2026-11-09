import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "../uploads/images");

// Uploaded files are named "<uuid>" plus the original extension (if any) by the upload middleware.
// Anything else (including "../" sequences) is rejected before touching the filesystem.
const SAFE_FILENAME = /^[A-Za-z0-9-]+(\.[A-Za-z0-9]+)?$/;

// Express handler that serves a file from the uploads directory by :filename
export const sendUploadedImage = (req, res) => {
  const { filename } = req.params;

  if (!SAFE_FILENAME.test(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }

  // root confines the lookup to UPLOADS_DIR even if the check above were bypassed.
  // Safe: filename is validated against SAFE_FILENAME and served relative to root.
  // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile
  res.sendFile(filename, { root: UPLOADS_DIR, dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "File not found" });
    }
  });
};
