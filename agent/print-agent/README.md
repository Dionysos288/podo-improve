## Podo Improve – Local Print Agent

This agent runs on the **user PC** and handles IdeaMaker slicing locally.
The web server cannot execute `ideaMaker.exe` on a user machine, so the agent does it.

### What it does

1. **Connects** to the webapp and fetches its configuration (including `ideamakerPath`)
2. **Polls** for slicing jobs (STL files that need to be converted to Gcode)
3. **Runs IdeaMaker** locally to slice STL files
4. **Uploads** the generated Gcode back to the server

### Setup (For End Users)

1. **In the web app**: Go to **Settings → Basis → Lokale Print Agent**
   - Set your **IdeaMaker pad (exe)** (e.g., `C:\Program Files\Raise3D\ideaMaker-App\ideaMaker.exe`)
   - Click **Opslaan** to generate an **Agent token**

2. **Choose your setup method**:

   **Option A: Manual Start (Simple)**
   - Click **"Agent downloaden"** → Downloads `start-agent.bat`
   - Place the file in any folder you want (e.g., Desktop, Documents)
   - Double-click to run the agent (you'll need to do this each time)
   - The agent file (`agent.mjs`) will be downloaded automatically on first run

   **Option B: Auto-Start (Recommended)**
   - Click **"Auto-start installeren"** → Downloads `install-auto-start.bat`
   - Place the file in any folder you want
   - Run it once to set up auto-start
   - The agent will start automatically when you log in to Windows
   - Runs minimized in the background
   - The agent file will be downloaded automatically if needed

3. **Verify it's working**: Check Settings → the status should show "gekoppeld"

**That's it!** The agent will automatically:

- Fetch your IdeaMaker path from the server
- Verify IdeaMaker exists
- Start polling for slicing jobs

### Manual Setup (For Developers)

If you prefer to run manually:

```bash
node agent/print-agent/agent.mjs --url http://localhost:3000 --token YOUR_TOKEN
```

### Files

- `ping.mjs` - Simple ping script (for testing)
- `agent.mjs` - Full agent with job polling and IdeaMaker execution
