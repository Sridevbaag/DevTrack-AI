import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Firebase Admin safely
let isDbAdminReady = false;
let adminDb: any = null;
let firebaseConfig: any = null;

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (firebaseConfig && firebaseConfig.projectId) {
      const appInstance = admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
      const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
      adminDb = getFirestore(appInstance, dbId);
      isDbAdminReady = true;
      console.log(`Firebase Admin initialized for Firestore project: ${firebaseConfig.projectId}, db: ${dbId}`);
    }
  } else {
    console.warn("firebase-applet-config.json not found. Firestore Admin scheduled check will be offline.");
  }
} catch (error) {
  console.error("Firebase Admin initialization failed gracefully. Running background task in demo mode.", error);
}

// Local fallback generator for developer task breakdown (when Gemini is rate-limited / out of quota)
function generateFallbackTask(title: string, description: string) {
  let priority = "Medium";
  const descLower = (description || "").toLowerCase();
  const titleLower = title.toLowerCase();

  if (
    descLower.includes("high") ||
    descLower.includes("urgent") ||
    descLower.includes("asap") ||
    descLower.includes("critical") ||
    titleLower.includes("urgent")
  ) {
    priority = "High";
  } else if (descLower.includes("low") || descLower.includes("minor") || descLower.includes("casual")) {
    priority = "Low";
  }

  let subtasks: string[] = [];
  let firstStep = "";
  let startNowPlan: string[] = [];
  let timeEstimate = "4 hours";

  if (titleLower.includes("refactor") || titleLower.includes("clean") || titleLower.includes("optimize")) {
    subtasks = [
      "Review the existing codebase and identify bottlenecks/redundancies",
      "Draft a refactoring plan to separate concerns and improve modularity",
      "Rewrite components/functions following clean coding principles",
      "Run unit tests and linting to ensure no regressions",
      "Review and verify changes with performance benchmarks"
    ];
    firstStep = "Open the target module file and inspect its main functions/imports.";
    startNowPlan = [
      "Open the project directory and locate the code files you want to work on.",
      "Add a 'TODO: refactor' or diagnostic comment on the most complex function.",
      "Delete 3 lines of unused code or imports to kickstart the cleaning."
    ];
    timeEstimate = "6 hours";
  } else if (titleLower.includes("bug") || titleLower.includes("fix") || titleLower.includes("error") || titleLower.includes("issue")) {
    subtasks = [
      "Reproduce the bug locally and capture exact error logs",
      "Locate the route, function, or component raising the exception",
      "Write a targeted fix for the root cause structure",
      "Verify the fix works with multiple test corner cases",
      "Review and cross-check for potential side-effects"
    ];
    firstStep = "Open the browser dev console or terminal to inspect the active stack trace.";
    startNowPlan = [
      "Open the files associated with the error or stack trace.",
      "Add a console.log or break point right before the place the bug occurs.",
      "Run the applet and trigger the bug once to verify the payload/context."
    ];
    timeEstimate = "3 hours";
  } else if (titleLower.includes("test") || titleLower.includes("spec") || titleLower.includes("cypress") || titleLower.includes("jest")) {
    subtasks = [
      "Identify the core user paths and edge-cases that need validation",
      "Create test file suites and wire up basic assertion frameworks",
      "Write unit tests for the complex pure helper functions",
      "Implement end-to-end user behavioral integration tests",
      "Verify coverage reports and integrate into pre-commit scripts"
    ];
    firstStep = "Create the test spec files in your source directory.";
    startNowPlan = [
      "Open package.json to inspect which test libraries are already installed.",
      "Create a basic test file with a simple '1 + 1 === 2' mock assertion.",
      "Run the test command (`npm run test`) once to verify the test runner spins up."
    ];
    timeEstimate = "5 hours";
  } else if (titleLower.includes("ui") || titleLower.includes("css") || titleLower.includes("style") || titleLower.includes("design") || titleLower.includes("layout")) {
    subtasks = [
      "Draft layout mockups and review spacing/colour palette requirements",
      "Structure high-level container divs, margins, and flex grids",
      "Implement individual responsive controls, buttons, and input components",
      "Apply interactive hover transitions, focus rings, and dark/light pairings",
      "Double-check responsiveness across mobile, tablet, and widescreen viewports"
    ];
    firstStep = "Open the main UI file and sketch out the component skeleton.";
    startNowPlan = [
      "Open the primary page or layout file inside the source code editor.",
      "Write a temporary diagnostic wrapper div with a highly visible border (e.g. border-red-500).",
      "Adjust a single margin or padding variable to see the live update take effect."
    ];
    timeEstimate = "4 hours";
  } else {
    subtasks = [
      `Review requirements and scope specifications for: "${title}"`,
      "Draft technical implementation plan and setup files/dependencies",
      "Build core components, helper logic, and API routes",
      "Integrate services, design custom UI controls, and bind states",
      "Conduct rigorous user path debugging, lint checks, and polish cycles"
    ];
    firstStep = `Create a scratchpad file or comment block mapping the architecture for: "${title}".`;
    startNowPlan = [
      "Open your code editor and split the screen to display this task breakdown next to your code.",
      "Write a placeholder comment or single function signature in your entry file.",
      "Save the file to ensure the hot reload is active and working beautifully."
    ];
    timeEstimate = "8 hours";
  }

  return {
    subtasks,
    priority,
    timeEstimate,
    firstStep,
    startNowPlan,
    isFallback: true
  };
}

// Local fallback generator for motivational developer nudges (when Gemini is rate-limited / out of quota)
function generateFallbackNudge(title: string, incompleteSubtasks: string[]) {
  const unfinished = Array.isArray(incompleteSubtasks) && incompleteSubtasks.length > 0
    ? incompleteSubtasks[0]
    : "this amazing task";

  const standardNudges = [
    `Hey! Don't let momentum slip away. Let's spend just 5 minutes on "${unfinished}" right now!`,
    `A wise developer once said: "Shipping beats perfection." Let's knock out "${unfinished}" first.`,
    `No pressure, but "${unfinished}" is calling your name! Let's get a quick win on the board.`,
    `Breaking inertia is 90% of the battle. Open your code editor and tackle "${unfinished}"—you've got this!`,
    `A small commit a day keeps the deadline anxiety away. Let's make progress on "${unfinished}"!`,
    `Ready to level up? Tackling "${unfinished}" right now will put you ahead of schedule!`,
    `Let's focus on the absolute priority. A solid 15-minute chunk of effort on "${unfinished}" is all you need to start.`,
    `We can't compile if we don't code! Let's make some headway on "${unfinished}" right now.`
  ];

  const randomIndex = Math.floor(Math.random() * standardNudges.length);
  return standardNudges[randomIndex];
}

// Helper to get a properly configured GoogleGenAI instance with 'aistudio-build' User-Agent telemetry
function getGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Helper function to call Gemini with retry and model fallback behavior on 503/429 transient errors
async function generateContentWithRetry(
  ai: GoogleGenAI,
  options: {
    model: string;
    contents: any;
    config?: any;
  },
  maxRetries = 4
): Promise<any> {
  const modelsToTry = [
    options.model,               // 1. "gemini-3.5-flash"
    "gemini-flash-latest",       // 2. Fallback 1
    "gemini-3.1-flash-lite"      // 3. Fallback 2
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    let delay = 1500; // start with 1.5s for a slightly safer base delay under load
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Gemini Request] Calling ${model} (attempt ${attempt}/${maxRetries})...`);
        const response = await ai.models.generateContent({
          model: model,
          contents: options.contents,
          config: options.config,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const status = error.status || (error.error && error.error.code);
        const errorMessage = String(error.message || "").toUpperCase();
        const isTransient = status === 503 || status === 429 || 
                            errorMessage.includes("503") || 
                            errorMessage.includes("429") || 
                            errorMessage.includes("UNAVAILABLE") ||
                            errorMessage.includes("TEMPORARY") ||
                            errorMessage.includes("HIGH DEMAND") ||
                            errorMessage.includes("RATE_LIMIT") ||
                            errorMessage.includes("QUOTA_EXCEEDED") ||
                            errorMessage.includes("RESOURCE_EXHAUSTED");

        if (isTransient && attempt < maxRetries) {
          // Add random jitter to avoid thundering herd problem during transient outages
          const jitter = Math.floor(Math.random() * 800);
          const totalDelay = delay + jitter;
          console.warn(`[Gemini Request] ${model} failed with transient error ${status || "503/UNAVAILABLE"} (attempt ${attempt}/${maxRetries}). Retrying in ${totalDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, totalDelay));
          delay = Math.min(delay * 2.5, 15000); // backoff exponentially, up to a max of 15 seconds
        } else {
          console.warn(`[Gemini Request] ${model} failed permanently or exhausted retries: ${error.message || error}`);
          break;
        }
      }
    }
  }

  throw lastError || new Error("Failed to generate content with Gemini after exhausting fallbacks.");
}

// 1. Generate Task Breakdown using Gemini
app.post("/api/generate-task", async (req, res) => {
  const { title, description } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[DevTrack AI] GEMINI_API_KEY is missing. Falling back to clean local breakdown.");
      const fallbackResult = generateFallbackTask(title, description);
      return res.json(fallbackResult);
    }

    const ai = getGeminiClient(apiKey);
    
    const prompt = `You are DevTrack AI, an ultimate personal developer productivity coach. 
Analyze the following developer task and break it down logically.

Task Title: ${title}
Task Description: ${description || "No description provided."}

Break it down into:
- 3 to 6 detailed logical subtasks.
- Priority level (High, Medium, or Low).
- Realistic developer time estimate (e.g. "4 hours", "2 days", etc.).
- "First Step": A single simple, concrete action item to do right now to build momentum (e.g., "Create db/connection.ts file and write type interfaces").
- "Start Now Plan": 3 ultra-short actionable sub-steps to overcome inertia and start right away (each should take less than 5 minutes).`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subtasks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of 3 to 6 logical detailed subtask titles to complete the overall task",
            },
            priority: {
              type: Type.STRING,
              description: "Must be exactly 'High', 'Medium', or 'Low'",
            },
            timeEstimate: {
              type: Type.STRING,
              description: "A concrete developer-focused time estimate (e.g. '2 hours', '3 days')",
            },
            firstStep: {
              type: Type.STRING,
              description: "Simple, concrete first action button/first line of code to start",
            },
            startNowPlan: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Exactly 3 quick steps to start right now",
            },
          },
          required: ["subtasks", "priority", "timeEstimate", "firstStep", "startNowPlan"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No structured response generated by Gemini.");
    }

    const result = JSON.parse(text);
    return res.json(result);
  } catch (error: any) {
    console.error("Gemini Task Generation Error:", error);
    console.info("[DevTrack AI] Falling back immediately to local deterministic task breakdown generator.");
    const fallbackResult = generateFallbackTask(title, description || "");
    return res.json(fallbackResult);
  }
});

// 2. Generate Nudge Endpoint (Can be used by scheduled backgrounds or frontend)
app.post("/api/generate-nudge", async (req, res) => {
  const { title, description, progress, priority, deadline, incompleteSubtasks } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[DevTrack AI] GEMINI_API_KEY is not configured. Falling back to local developer nudge.");
      const nudgeText = generateFallbackNudge(title, incompleteSubtasks || []);
      return res.json({ nudge: nudgeText, isFallback: true });
    }

    const ai = getGeminiClient(apiKey);

    const prompt = `You are DevTrack AI, a supportive and motivating team lead.
The developer is working on this task and is currently behind schedule:
Task: "${title}"
Description: "${description || "No description provided."}"
Priority: ${priority || "Medium"}
Current Progress: ${progress || 0}%
Deadline: ${deadline || "No deadline"}
Unfinished steps left: ${JSON.stringify(incompleteSubtasks || [])}

Deliver a short, proactive nudge. 
- Keep it 1 to 2 sentences.
- Be personal, direct, and slightly cheeky or fun (developer-themed).
- Mention one of their unfinished subtasks specifically to inspire them.
- Speak directly to them ("you").`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    return res.json({ nudge: response.text?.trim() || "Let's make some headway on this task today!" });
  } catch (error: any) {
    console.error("Nudge generation error:", error);
    console.info("[DevTrack AI] Falling back immediately to local developer nudge generator.");
    const nudgeText = generateFallbackNudge(title, incompleteSubtasks || []);
    return res.json({ nudge: nudgeText, isFallback: true });
  }
});

// Server-side scheduled check: runs every 60 seconds
// Scans for tasks that are behind schedule, auto-generates nudges, and updates Firestore directly.
setInterval(async () => {
  if (!isDbAdminReady || !adminDb) {
    return; // No admin credentials present (e.g. offline dev check)
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return; // Cannot generate nudges without API key
  }

  try {
    console.log("[DevTrack AI Scheduler] Checking upcoming deadlines for proactive nudges...");
    const tasksSnapshot = await adminDb.collection("tasks").get();
    if (tasksSnapshot.empty) {
      return;
    }

    const now = new Date();

    for (const doc of tasksSnapshot.docs) {
      const data = doc.data();
      const progress = data.progress ?? 0;
      
      // Only nudge incomplete tasks
      if (progress >= 100 || data.status === "Completed") {
        continue;
      }

      // If already nudged recently (within last 3 hours), skip to avoid spamming
      if (data.nudgeTime) {
        const lastNudge = new Date(data.nudgeTime);
        const hoursSinceNudge = (now.getTime() - lastNudge.getTime()) / (1000 * 60 * 60);
        if (hoursSinceNudge < 3) {
          continue; 
        }
      }

      let isBehind = false;

      // Rule 1: Deadline-based tracking
      if (data.deadline) {
        const deadlineDate = new Date(data.deadline);
        const createdDate = data.createdTime ? new Date(data.createdTime) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        const totalDuration = deadlineDate.getTime() - createdDate.getTime();
        const elapsedDuration = now.getTime() - createdDate.getTime();

        const timeRatio = totalDuration > 0 ? elapsedDuration / totalDuration : 1.0;

        // If deadline is passed and progress < 100 -> Behind
        if (now > deadlineDate) {
          isBehind = true;
        } 
        // If elapsed time ratio is > 50% but progress is < 35% -> Behind
        else if (timeRatio > 0.5 && progress < 35) {
          isBehind = true;
        }
        // If deadline is in less than 24 hours and progress is < 70% -> Behind
        else if (deadlineDate.getTime() - now.getTime() < 24 * 60 * 60 * 1000 && progress < 70) {
          isBehind = true;
        }
      }

      // If behind, generate nudge and update
      if (isBehind) {
        console.log(`[DevTrack AI Scheduler] Task "${data.title}" is flagged as Behind schedule. Generating nudge...`);
        
        const incomplete = (data.subtasks || [])
          .filter((s: any) => !s.completed)
          .map((s: any) => s.title);

        let nudgeText = "";
        try {
          const ai = getGeminiClient(apiKey);
          const prompt = `You are DevTrack AI, a helpful, encouraging team lead. 
The developer is behind on task "${data.title}". Priority: ${data.priority || "Medium"}. Progress: ${progress}%. Deadline: ${data.deadline || "Soon"}.
Unfinished items: ${JSON.stringify(incomplete.slice(0, 3))}.
Write a short, friendly, developer-relevant nudge (1-2 sentences) encouraging them to tackle one of these subtasks. Speak as "DevTrack AI".`;

          const response = await generateContentWithRetry(ai, {
            model: "gemini-3.5-flash",
            contents: prompt,
          });

          nudgeText = response.text?.trim() || "Keep pushing forward! Every line of code counts.";
        } catch (genErr) {
          console.warn(`[DevTrack AI Scheduler] Gemini API call failed during background check for "${data.title}". Using fallback developer nudge.`, genErr);
          nudgeText = generateFallbackNudge(data.title, incomplete);
        }

        // Write nudge directly into Firestore
        await doc.ref.update({
          nudge: nudgeText,
          nudgeTime: now.toISOString(),
          status: "Behind"
        });

        console.log(`[DevTrack AI Scheduler] Proactive nudge generated & inserted into Firestore for "${data.title}"`);
      }
    }
  } catch (error: any) {
    const errorMessage = String(error.message || error);
    const isPermissionDenied = error.code === 7 || 
                               errorMessage.includes("7 PERMISSION_DENIED") || 
                               errorMessage.includes("PERMISSION_DENIED") || 
                               errorMessage.includes("Missing or insufficient permissions");
    const isQuotaExceeded = errorMessage.includes("429") || 
                            errorMessage.includes("RESOURCE_EXHAUSTED") || 
                            errorMessage.includes("quota") || 
                            errorMessage.toUpperCase().includes("QUOTA");

    if (error.code === 5 || (error.message && error.message.includes("5 NOT_FOUND"))) {
      console.warn("[DevTrack AI Scheduler] Firestore database was not found on Google Cloud. It might not be provisioned yet or is not initialized in this project. Deactivating scheduler background scanner to prevent error logging.");
      isDbAdminReady = false;
    } else if (isPermissionDenied) {
      console.warn("[DevTrack AI Scheduler] Firebase Admin SDK lacks sufficient IAM permissions to read/write the cross-project user Firestore database in the sandbox. Deactivating scheduler background scanner to prevent log noise.");
      isDbAdminReady = false;
    } else if (isQuotaExceeded) {
      console.warn("[DevTrack AI Scheduler] Gemini API quota limit exceeded during background task. Skipping this round of automatic nudging.");
    } else {
      console.error("Scheduler background task error: ", error);
    }
  }
}, 15 * 60 * 1000);

// Integrate Vite Middleware
async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev server middleware mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DevTrack AI Express running on http://localhost:${PORT}`);
  });
}

startServer();
