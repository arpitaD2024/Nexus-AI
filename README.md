# Nexus Autonomous Orchestrator

Nexus is a high-density, multi-agent enterprise orchestration system designed to automate complex workflows (Procurement, IT, Logistics) with a focus on **Resilience**, **Transparency**, and **Human-in-the-Loop (HITL)** safety.

## 🚀 Key Features

- **Multi-Agent Network:** Collaborative execution by specialized agents:
  - **Orchestrator:** Plans and categorizes tasks.
  - **Risk Analyst:** Predicts SLA breaches and identifies high-value transactions.
  - **Executor:** Performs technical actions and verifies constraints (e.g., lead times).
  - **System Monitor:** Detects real-time failures and connection timeouts.
  - **Self-Healer:** Dynamically generates recovery strategies for failed steps.
  - **Auditor:** Finalizes the immutable transaction log.
- **Self-Healing Core:** Automated retry logic with AI-driven "patches" for execution failures.
- **Chaos Mode:** Integrated stress-testing environment that injects network jitter and increases failure probability to verify system robustness.
- **Risk-Based Intervention:** Automatic "Human-in-the-Loop" pauses for tasks exceeding $5,000 or a 30% risk threshold.
- **Live System Pulse:** Real-time WebSocket-driven terminal showing the "heartbeat" of the orchestration engine.
- **Agent Interrogation:** Deep-dive into any agent's decision-making process via the "Ask Agent" interface.

## 🛠 Technical Architecture

- **Intelligence:** Google Gemini 3 Flash (LLM) with hardened JSON response schemas.
- **Backend:** Node.js / Express server with WebSocket (WS) support for real-time state synchronization.
- **Frontend:** React + Vite + Tailwind CSS.
- **Animations:** Framer Motion for fluid state transitions.
- **Data Viz:** Recharts for predictive risk modeling.
- **Persistence:** In-memory server-side store for workflows and audit logs (demo mode).

## 🚦 Getting Started

### Prerequisites

- Node.js (v18+)
- A Google Gemini API Key

### Installation

1. Clone the repository (or export from AI Studio).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables in a `.env` file:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

### Running the App

Start the development server (Express + Vite):
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

## 🔒 Data Security & Compliance

- **Immutable Audit Trail:** Every agent "thought," action, and result is logged with a timestamp and cannot be modified.
- **Schema Hardening:** Strict JSON schema enforcement prevents malformed AI outputs and prompt injection vulnerabilities.
- **HITL Thresholds:** Hardcoded business logic ensures high-value transactions ($5,000+) always require manual authorization.
- **PII Awareness:** Designed for future integration of PII redaction layers before data reaches the LLM.

## 📈 Future Roadmap

- **Multi-Modal Analysis:** Support for document uploads (Invoices, Lead-time PDFs).
- **Cross-Workflow Memory:** Agents learning from historical healing strategies.
- **Enterprise Integration:** Secure API connectors for SAP, Oracle, and Salesforce.
- **Advanced RBAC:** Fine-grained permissions for "Authorize Execution" actions.

---
*Built with Google AI Studio Build*
