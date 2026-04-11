# Zoya (卓雅) — The Zero-Footprint Legal Advocate 🛡️

**Zoya** is a high-agency, agentic AI platform designed specifically for domestic violence survivors in Hong Kong. It bridges the critical gap between raw evidence (chat logs, injury photos) and the formal requirements of the HK judicial system.

## 🚀 Key Features

- **Forensic Evidence Vault**: Multimodal ingestion of injury photos (via Vision AI) and WhatsApp chat exports (via NLP) to identify patterns of abuse.
- **Statutory Chronology Extraction**: Automatically maps disorganized chat logs into a professional, court-ready **Statutory Chronology of Events**.
- **Zero-Footprint Form Architect**: A trauma-informed, ephemeral document generation system. Forms like CSSA, Legal Aid, and Injunction Affidavits are drafted in-browser memory and never stored locally on the survivor's device.
- **Sentinel Safety Layer**: High-agency safety features including a **Triple-Tap Panic Mode** (decoy UI), inactivity auto-purge, and encrypted local state.
- **Real-Time Shelter Monitoring**: Live waitlist tracking for HK crisis centers (Harmony House, Serene Court, etc.) with decoy plant-bloom notifications.

## 🛠️ Tech Stack

- **Intelligence**: Google Gemini 2.5 Flash (via Vertex AI)
- **Frontend**: React 19 + Vite (Vanilla CSS Serene Design System)
- **Backend**: Node.js + Express
- **Vision**: Vertex AI Vision for forensic image analysis
- **Security**: 256-bit Encrypted LocalStorage + Ephemeral DOM Rendering

## 📦 Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file with your Google Cloud Vertex AI credentials.

3. **Run Locally**:
   ```bash
   npm start
   ```
   (Launches both the Vite frontend and the Node.js backend concurrently).

## 🔒 Privacy & Safety
Zoya is built on the principle of **Trauma-Informed Security**. No sensitive legal data is ever persisted to a centralized server. All forensic analysis happens in ephemeral sessions, and the application can be instantly cloaked as a benign "Zen Plant" or "Calculator" decoy through panic triggers.

---
*Built for the GDG Hackathon 2026 — Advancing Agentic Advocacy for Survivors.*
