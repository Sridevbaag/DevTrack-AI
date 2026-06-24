import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Sparkles, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Calendar, 
  Flame, 
  Clock, 
  AlertTriangle, 
  RefreshCw, 
  LogOut,
  CheckSquare, 
  Brain, 
  LayoutDashboard, 
  Lightbulb, 
  ChevronDown,
  ChevronUp,
  RotateCcw,
  X,
  Play,
  Maximize2,
  ListPlus,
  PlusCircle,
  Sun,
  Moon
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { User } from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc 
} from "firebase/firestore";

import { db, googleSignIn, logout, initAuth, OperationType, handleFirestoreError } from "./lib/firebase";
import { Task, Subtask } from "./types";
import { createCalendarEvent, updateCalendarEventStatus, deleteCalendarEvent } from "./lib/calendar";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("theme") as "dark" | "light") || "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskDeadline, setTaskDeadline] = useState("");
  const [autoCalendar, setAutoCalendar] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [tempBreakdown, setTempBreakdown] = useState<{
    subtasks: string[];
    priority: "High" | "Medium" | "Low";
    timeEstimate: string;
    firstStep: string;
    startNowPlan: string[];
  } | null>(null);

  // Focus Mode State
  const [activeFocusTaskId, setActiveFocusTaskId] = useState<string | null>(null);
  const activeFocusTask = useMemo(() => {
    return tasks.find(t => t.id === activeFocusTaskId) || null;
  }, [tasks, activeFocusTaskId]);

  const [currentFilter, setCurrentFilter] = useState<"All" | "Behind" | "On Track" | "Completed">("All");
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [nudgeLoading, setNudgeLoading] = useState<Record<string, boolean>>({});
  const [nudgeErrors, setNudgeErrors] = useState<Record<string, string | null>>({});

  // Manual Task State
  const [creationMode, setCreationMode] = useState<"ai" | "manual">("ai");
  const [manualPriority, setManualPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [manualTimeEstimate, setManualTimeEstimate] = useState("2 hours");
  const [manualSubtasks, setManualSubtasks] = useState<string[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");



  useEffect(() => {
    const unsub = initAuth(
      (currentUser, token) => {
        setUser(currentUser);
        setAccessToken(token);
        setIsAuthChecking(false);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setIsAuthChecking(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setTasks([]);
      return;
    }
    setLoadingTasks(true);
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: Task[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Task);
        });
        list.sort((a, b) => {
          const tA = a.createdTime ? new Date(a.createdTime).getTime() : 0;
          const tB = b.createdTime ? new Date(b.createdTime).getTime() : 0;
          return tB - tA;
        });
        setTasks(list);
        setLoadingTasks(false);
      },
      (error) => {
        console.error("Firestore listening error:", error);
        setLoadingTasks(false);
        try {
          handleFirestoreError(error, OperationType.GET, "tasks");
        } catch (e) {
        }
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (tasks.length > 0) {
      const newExp = { ...expandedTasks };
      let changed = false;
      tasks.forEach(t => {
        if (newExp[t.id] === undefined) {
          newExp[t.id] = true;
          changed = true;
        }
      });
      if (changed) setExpandedTasks(newExp);
    }
  }, [tasks]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
      }
    } catch (err) {
      console.error("Authentication error:", err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setAccessToken(null);
      setTempBreakdown(null);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const handleAIBreakdown = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    setIsGenerating(true);
    setGenerationError(null);
    setTempBreakdown(null);

    try {
      const response = await fetch("/api/generate-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: taskTitle, description: taskDesc }),
      });

      if (!response.ok) {
        const errorJson = await response.json();
        throw new Error(errorJson.error || "Failed to decompose task");
      }

      const parsedJSON = await response.json();
      
      // Calculate dynamic priority based on target deadline:
      // <= 1 day: High, <= 7 days (about 1 week): Medium, > 7 days (about 1 month or above): Low
      if (taskDeadline) {
        const deadlineDate = new Date(taskDeadline);
        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        deadlineDate.setHours(0, 0, 0, 0);
        const diffTime = deadlineDate.getTime() - currentDate.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 1) {
          parsedJSON.priority = "High";
        } else if (diffDays <= 7) {
          parsedJSON.priority = "Medium";
        } else {
          parsedJSON.priority = "Low";
        }
      }

      setTempBreakdown(parsedJSON);
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || "An unexpected error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommitTask = async () => {
    if (!user || !tempBreakdown) return;

    try {
      const createdTime = new Date().toISOString();
      let finalizedSubtasks: Subtask[] = tempBreakdown.subtasks.map((st, idx) => ({
        id: `st-${Date.now()}-${idx}`,
        title: st,
        completed: false,
      }));

      if (autoCalendar && accessToken && taskDeadline) {
        console.log("Scheduling subtasks to Google Calendar...");
        const deadlineDate = new Date(taskDeadline);
        const currentDate = new Date();
        const rawDaysDiff = Math.ceil((deadlineDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
        const daysDiff = Math.max(1, rawDaysDiff);

        for (let i = 0; i < finalizedSubtasks.length; i++) {
          const spacingRatio = Math.min(1, i / (finalizedSubtasks.length || 1));
          const stepOffsetDays = Math.round(spacingRatio * daysDiff);
          const scheduledStepDate = new Date();
          scheduledStepDate.setDate(currentDate.getDate() + stepOffsetDays);
          const dateStr = scheduledStepDate.toISOString().split("T")[0];

          const eventId = await createCalendarEvent(
            accessToken,
            taskTitle,
            finalizedSubtasks[i].title,
            dateStr,
            tempBreakdown.timeEstimate
          );

          if (eventId) {
            finalizedSubtasks[i].calendarEventId = eventId;
            finalizedSubtasks[i].scheduledTime = dateStr;
          }
        }
      }

      const newTask: Omit<Task, "id"> = {
        userId: user.uid,
        title: taskTitle,
        description: taskDesc,
        priority: tempBreakdown.priority,
        timeEstimate: tempBreakdown.timeEstimate,
        firstStep: tempBreakdown.firstStep,
        startNowPlan: tempBreakdown.startNowPlan,
        subtasks: finalizedSubtasks,
        deadline: taskDeadline,
        createdTime,
        progress: 0,
        status: "On Track",
        nudge: null,
        nudgeTime: null,
      };

      try {
        await addDoc(collection(db, "tasks"), newTask);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, "tasks");
      }

      setTaskTitle("");
      setTaskDesc("");
      setTaskDeadline("");
      setTempBreakdown(null);
    } catch (error) {
      console.error("Error committing task down:", error);
    }
  };

  const handleAddManualSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    setManualSubtasks(prev => [...prev, newSubtaskTitle.trim()]);
    setNewSubtaskTitle("");
  };

  const handleRemoveManualSubtask = (index: number) => {
    setManualSubtasks(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateTaskManually = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !taskTitle.trim()) return;

    try {
      const createdTime = new Date().toISOString();
      const rawSubtasks = manualSubtasks.length > 0 ? manualSubtasks : ["Initialize development pipeline"];
      
      let finalizedSubtasks: Subtask[] = rawSubtasks.map((st, idx) => ({
        id: `st-${Date.now()}-${idx}`,
        title: st,
        completed: false,
      }));

      if (autoCalendar && accessToken && taskDeadline) {
        console.log("Scheduling subtasks to Google Calendar...");
        const deadlineDate = new Date(taskDeadline);
        const currentDate = new Date();
        const rawDaysDiff = Math.ceil((deadlineDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
        const daysDiff = Math.max(1, rawDaysDiff);

        for (let i = 0; i < finalizedSubtasks.length; i++) {
          const spacingRatio = Math.min(1, i / (finalizedSubtasks.length || 1));
          const stepOffsetDays = Math.round(spacingRatio * daysDiff);
          const scheduledStepDate = new Date();
          scheduledStepDate.setDate(currentDate.getDate() + stepOffsetDays);
          const dateStr = scheduledStepDate.toISOString().split("T")[0];

          const eventId = await createCalendarEvent(
            accessToken,
            taskTitle,
            finalizedSubtasks[i].title,
            dateStr,
            manualTimeEstimate
          );

          if (eventId) {
            finalizedSubtasks[i].calendarEventId = eventId;
            finalizedSubtasks[i].scheduledTime = dateStr;
          }
        }
      }

      const firstStep = rawSubtasks[0];
      const startNowPlan = [
        `Setup local testing workspace for ${firstStep.toLowerCase()}`,
        "Complete a tiny, high-impact 5-minute action step to build momentum",
        "Run lint/compiler checks to make sure the build stays pristine"
      ];

      const newTask: Omit<Task, "id"> = {
        userId: user.uid,
        title: taskTitle,
        description: taskDesc,
        priority: manualPriority,
        timeEstimate: manualTimeEstimate,
        firstStep,
        startNowPlan,
        subtasks: finalizedSubtasks,
        deadline: taskDeadline,
        createdTime,
        progress: 0,
        status: "On Track",
        nudge: null,
        nudgeTime: null,
      };

      await addDoc(collection(db, "tasks"), newTask);

      // Reset Form fields
      setTaskTitle("");
      setTaskDesc("");
      setTaskDeadline("");
      setManualSubtasks([]);
      setNewSubtaskTitle("");
      setManualPriority("Medium");
      setManualTimeEstimate("2 hours");
    } catch (error) {
      console.error("Error creating manual task:", error);
      handleFirestoreError(error, OperationType.CREATE, "tasks");
    }
  };

  const handleToggleSubtask = async (task: Task, subtaskId: string) => {
    try {
      const updatedSubtasks = task.subtasks.map((st) => {
        if (st.id === subtaskId) {
          const nextCompleted = !st.completed;
          if (st.calendarEventId && accessToken) {
            updateCalendarEventStatus(accessToken, st.calendarEventId, st.title, nextCompleted)
              .then(success => console.log("GCal task completeness updated:", success))
              .catch(err => console.error("GCal update failure:", err));
          }
          return { ...st, completed: nextCompleted };
        }
        return st;
      });

      const completedCount = updatedSubtasks.filter(st => st.completed).length;
      const progress = Math.round((completedCount / (updatedSubtasks.length || 1)) * 100);
      const status = progress === 100 ? "Completed" : "On Track";

      const taskRef = doc(db, "tasks", task.id);
      await updateDoc(taskRef, {
        subtasks: updatedSubtasks,
        progress,
        status,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const handleDeleteTask = async (task: Task) => {
    const confirmed = window.confirm(`Are you sure you want to delete the task "${task.title}" and its scheduled Google Calendar events?`);
    if (!confirmed) return;

    try {
      if (accessToken) {
        for (const st of task.subtasks) {
          if (st.calendarEventId) {
            await deleteCalendarEvent(accessToken, st.calendarEventId);
          }
        }
      }

      await deleteDoc(doc(db, "tasks", task.id));
    } catch (err) {
      console.error("Failed to delete task:", err);
      handleFirestoreError(err, OperationType.DELETE, `tasks/${task.id}`);
    }
  };

  const handleRegenerateNudge = async (task: Task) => {
    setNudgeLoading(prev => ({ ...prev, [task.id]: true }));
    setNudgeErrors(prev => ({ ...prev, [task.id]: null }));
    try {
      const incomplete = task.subtasks
        .filter(st => !st.completed)
        .map(st => st.title);

      const response = await fetch("/api/generate-nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          progress: task.progress,
          priority: task.priority,
          deadline: task.deadline,
          incompleteSubtasks: incomplete,
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || "Server error generating nudge");
      }
      const { nudge } = await response.json();

      await updateDoc(doc(db, "tasks", task.id), {
        nudge,
        nudgeTime: new Date().toISOString(),
        status: "Behind"
      });
    } catch (err: any) {
      console.error("Live nudge generation error:", err);
      setNudgeErrors(prev => ({ ...prev, [task.id]: err.message || "Failed to generate AI nudge." }));
    } finally {
      setNudgeLoading(prev => ({ ...prev, [task.id]: false }));
    }
  };

  const [isSeeding, setIsSeeding] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleInjectDemo = async () => {
    if (!user) return;
    setIsSeeding(true);
    try {
      const demoTasks = [
        {
          userId: user.uid,
          title: "Implement OAuth & JWT Security Service",
          description: "Build robust auth routing, protect sensitive API endpoints, and establish token renewal protocols with Google OAuth.",
          priority: "High" as const,
          timeEstimate: "6 hours",
          firstStep: "Establish protected router files under /src/routes/auth.ts",
          startNowPlan: [
            "Define JSON Web Token interface structures inside types.ts",
            "Draft a single mock verification route returning 200 OK status",
            "Run your local server configuration to confirm route presence"
          ],
          deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          subtasks: [
            { id: `demo-st1-1-${Date.now()}`, title: "Configure JWT sign & verify utilities using RS256 algorithm", completed: false },
            { id: `demo-st1-2-${Date.now()}`, title: "Write Express interceptor middleware to parse Authorization Bearer headers", completed: false },
            { id: `demo-st1-3-${Date.now()}`, title: "Establish route guards and lock down administrative dashboards", completed: false },
            { id: `demo-st1-4-${Date.now()}`, title: "Set up secure httpOnly cookie delivery for refresh token flow", completed: false },
          ],
          progress: 25,
          status: "Behind" as const,
          nudge: "Hey! Don't let your token security drift. Let's spend just 5 minutes configuring the JWT utilities using the RS256 algorithm right now!",
          nudgeTime: new Date().toISOString(),
          createdTime: new Date(Date.now() - 3600000).toISOString()
        },
        {
          userId: user.uid,
          title: "Optimize Database Indexing & Query Latency",
          description: "Audit existing PostgreSQL schemas, review explain analyze plans, and declare compound query indexes.",
          priority: "Medium" as const,
          timeEstimate: "4 hours",
          firstStep: "Identify the top 3 slowest queries from database analytics logs",
          startNowPlan: [
            "Open your SQL workbench and pull up the current schema definition",
            "Execute a simple 'EXPLAIN ANALYZE' on the heaviest user table",
            "Mark a potential indexing field (like compound organization_id + created_at)"
          ],
          deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          subtasks: [
            { id: `demo-st2-1-${Date.now()}`, title: "Run index scan reports to identify table scans on large relations", completed: true },
            { id: `demo-st2-2-${Date.now()}`, title: "Construct compound indexes matching the primary dashboard filters", completed: false },
            { id: `demo-st2-3-${Date.now()}`, title: "Verify read latency drops under 100ms on complex joins", completed: false },
          ],
          progress: 33,
          status: "On Track" as const,
          nudge: null,
          nudgeTime: null,
          createdTime: new Date().toISOString()
        },
        {
          userId: user.uid,
          title: "Construct Interactive Real-time Metrics Dashboard",
          description: "Design reactive SVG chart wrappers, configure WebSocket subscribers, and add smooth entrance animations.",
          priority: "Low" as const,
          timeEstimate: "8 hours",
          firstStep: "Import Recharts or custom D3 SVG containers in DashboardView",
          startNowPlan: [
            "Inspect your websocket client hook to check if socket updates are online",
            "Add a placeholder SVG canvas with a 400px height inside your components directory",
            "Save and check the live browser preview for hot-reload rendering"
          ],
          deadline: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          subtasks: [
            { id: `demo-st3-1-${Date.now()}`, title: "Wire up WebSocket provider connection to listen to live sync events", completed: true },
            { id: `demo-st3-2-${Date.now()}`, title: "Create beautiful, fluid linear-gradient SVG line graphs for statistics", completed: true },
            { id: `demo-st3-3-${Date.now()}`, title: "Add smooth staggered entrance transitions to metric cards", completed: true },
          ],
          progress: 100,
          status: "Completed" as const,
          nudge: null,
          nudgeTime: null,
          createdTime: new Date().toISOString()
        }
      ];

      for (const t of demoTasks) {
        await addDoc(collection(db, "tasks"), t);
      }
    } catch (err) {
      console.error("Failed to seed demo tasks:", err);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleClearAllTasks = async () => {
    if (!user) return;
    const confirmed = window.confirm("Are you sure you want to delete ALL tasks from your Firestore database to start fresh?");
    if (!confirmed) return;
    setIsClearing(true);
    try {
      for (const t of tasks) {
        await deleteDoc(doc(db, "tasks", t.id));
      }
    } catch (err) {
      console.error("Failed to clear tasks:", err);
    } finally {
      setIsClearing(false);
    }
  };

  const handleSimulateProcrastination = async () => {
    const targetTask = tasks.find(t => t.status === "On Track" && t.progress < 100);
    if (!targetTask) {
      alert("No active 'On Track' tasks found to trigger. Please add a task or click 'Showcase Setup' first!");
      return;
    }

    try {
      const incomplete = targetTask.subtasks.filter(s => !s.completed).map(s => s.title);
      const simulatedNudge = `Proactive coach alerting is active! We noticed you haven't checked off "${incomplete[0] || 'the next step'}" yet. Open Focus Mode to tackle it immediately!`;
      await updateDoc(doc(db, "tasks", targetTask.id), {
        status: "Behind",
        nudge: simulatedNudge,
        nudgeTime: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to simulate lag:", err);
    }
  };

  const handleToggleExpandTask = (id: string) => {
    setExpandedTasks(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const stats = useMemo(() => {
    const total = tasks.length;
    const active = tasks.filter((t) => t.progress < 100).length;
    const completed = tasks.filter((t) => t.progress === 100).length;
    const behind = tasks.filter((t) => t.status === "Behind").length;
    const onTrack = tasks.filter((t) => t.status === "On Track" && t.progress < 100).length;
    
    const streak = tasks.reduce((sum, task) => sum + task.subtasks.filter(s => s.completed).length, 0);

    return { total, active, completed, behind, onTrack, streak };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (currentFilter === "All") return true;
      if (currentFilter === "Behind") return t.status === "Behind";
      if (currentFilter === "On Track") return t.status === "On Track" && t.progress < 100;
      if (currentFilter === "Completed") return t.progress === 100;
      return true;
    });
  }, [tasks, currentFilter]);

  if (isAuthChecking) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0f19] text-[#f3f4f6]">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="h-10 w-10 animate-spin text-indigo-400" />
          <p className="font-mono text-sm tracking-widest text-slate-400">LOADING WORKSPACE...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-gray-100 selection:bg-indigo-500 selection:text-white">
      {!user ? (
        <div className="relative flex flex-col items-center justify-center px-4 py-16 md:py-32 bg-[#0A0A0A]">
          {/* Floating theme toggle when logged out */}
          <div className="absolute top-6 right-6 z-50">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs font-semibold text-gray-400 transition-all hover:bg-white/10 hover:text-indigo-400 active:scale-95"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-indigo-400" />
              )}
            </button>
          </div>
          <div className="absolute top-1/4 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-500/5 blur-[100px]" />
          <div className="absolute bottom-1/4 left-1/3 -z-10 h-80 w-80 rounded-full bg-indigo-600/5 blur-[120px]" />

          <div className="w-full max-w-4xl text-center">
            <div className="mx-auto mb-6 flex w-fit items-center gap-2.5 rounded-full border border-white/5 bg-[#0F0F0F] px-4 py-1.5">
              <Sparkles className="h-4 w-4 text-indigo-400 animate-pulse" />
              <span className="font-sans text-xs font-semibold tracking-wider text-indigo-400 uppercase">DevTrack AI Platform</span>
            </div>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-indigo-400 bg-clip-text text-transparent pb-3">
              Hyper-Breakdown Your Dev Goals
            </h1>
            <p className="mt-4 mx-auto max-w-2xl text-lg text-gray-400 font-light leading-relaxed">
              Transform high-level tasks into high-fidelity Roadmaps. Structured subtask scheduling, proactive automated calendar events, and real-time developer nudges that hunt procrastination.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4">
              <button
                id="sign-in-btn"
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="gsi-material-button transition-all duration-300 transform active:scale-95 disabled:opacity-50"
              >
                <div className="gsi-material-button-state"></div>
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: "block" }}>
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents font-sans font-medium text-slate-800">
                    {isLoggingIn ? "Logging into console..." : "Sign in with Google"}
                  </span>
                </div>
              </button>

              <div className="flex items-center gap-3 text-gray-500 text-xs font-mono">
                <span>Secure Firestore Storage</span>
                <span>•</span>
                <span>Active Gemini 3.5 Engine</span>
              </div>
            </div>

            <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="group rounded-2xl border border-white/5 bg-[#141414] p-6 transition-all hover:border-indigo-500/30">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition-transform">
                  <Brain className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-white group-hover:text-indigo-300 transition-colors">Gemini 3.5 Engine Breakdown</h3>
                <p className="mt-2 text-sm text-gray-400 font-light leading-relaxed">
                  Inputs represent your high-level targets. Gemini decomposes them on the server into tactical subtasks, realistic deadlines, and priority profiles.
                </p>
              </div>

              <div className="group rounded-2xl border border-white/5 bg-[#141414] p-6 transition-all hover:border-indigo-500/30">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                  <Calendar className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-white group-hover:text-purple-300 transition-colors">Google Calendar Scheduler</h3>
                <p className="mt-2 text-sm text-gray-400 font-light leading-relaxed">
                  Schedules subtasks across active days directly into Google Calendar. Subtask checkmarks securely update your calendar states.
                </p>
              </div>

              <div className="group rounded-2xl border border-white/5 bg-[#141414] p-6 transition-all hover:border-indigo-500/30">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 group-hover:scale-110 transition-transform">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-white group-hover:text-orange-300 transition-colors">Proactive Server Nudges</h3>
                <p className="mt-2 text-sm text-gray-400 font-light leading-relaxed">
                  Our custom server background script watches tasks. If progress drops behind, it generates specific, clever micro-nudges to get you focused.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div id="dashboard-root" className="mx-auto max-w-7xl px-4 py-6 md:px-8 bg-[#0A0A0A]">
          
          <header className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 border border-white/5 bg-[#0F0F0F] p-6 rounded-2xl shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white animate-pulse" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                  DevTrack <span className="text-indigo-400">AI</span>
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3.5">
              <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || "User"} referrerPolicy="no-referrer" className="h-5 w-5 rounded-full ring-1 ring-white/10" />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white uppercase">
                    {user.email?.charAt(0)}
                  </div>
                )}
                <span className="font-medium text-gray-300 truncate max-w-[120px]">{user.displayName || user.email}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Google Sync Connected" />
              </div>

              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-400 transition-all hover:bg-white/10 hover:text-indigo-400 active:scale-95"
                title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              >
                {theme === "dark" ? (
                  <>
                    <Sun className="h-3.5 w-3.5 text-amber-400" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>

              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-gray-400 transition-all hover:bg-white/10 hover:text-red-400 active:scale-95"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          </header>



          <section className="mb-8 grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-5 rounded-2xl bg-[#141414] border border-white/5 relative overflow-hidden shadow-sm">
              <div className="absolute right-3 top-3 h-8 w-8 text-indigo-500/10">
                <LayoutDashboard className="h-full w-full" />
              </div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Active Tasks</p>
              <p className="text-2xl font-semibold mt-1 text-white">{stats.active}</p>
            </div>

            <div className="p-5 rounded-2xl bg-[#141414] border border-white/5 relative overflow-hidden shadow-sm">
              <div className="absolute right-3 top-3 h-8 w-8 text-emerald-500/10">
                <CheckCircle2 className="h-full w-full" />
              </div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Completed</p>
              <p className="text-2xl font-semibold mt-1 text-emerald-400">{stats.completed}</p>
            </div>

            <div className="p-5 rounded-2xl bg-[#141414] border border-white/5 relative overflow-hidden shadow-sm">
              <div className="absolute right-3 top-3 h-8 w-8 text-amber-500/10">
                <Clock className="h-full w-full" />
              </div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">On Track</p>
              <p className="text-2xl font-semibold mt-1 text-amber-400">{stats.onTrack}</p>
            </div>

            <div className="p-5 rounded-2xl bg-[#141414] border border-white/5 relative overflow-hidden shadow-sm">
              <div className="absolute right-3 top-3 h-8 w-8 text-rose-500/10">
                <AlertTriangle className="h-full w-full" />
              </div>
              <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Behind Goal</p>
              <p className="text-2xl font-semibold mt-1 text-rose-400">{stats.behind}</p>
            </div>

            <div className="col-span-2 md:col-span-1 p-5 rounded-2xl bg-indigo-900/20 border border-indigo-500/30 relative overflow-hidden shadow-sm">
              <div className="absolute right-3 top-3 h-8 w-8 text-indigo-400/20">
                <Flame className="h-full w-full animate-bounce" />
              </div>
              <p className="text-xs text-indigo-400 uppercase font-bold tracking-widest">Action Streak</p>
              <p className="text-2xl font-semibold mt-1 text-indigo-400 flex items-center gap-1.5">
                <Flame className="h-5 w-5 fill-indigo-400 text-indigo-400" />
                <span>{stats.streak}</span>
              </p>
            </div>
          </section>          {tasks.some((t) => t.status === "Behind" && t.nudge) && (
            <div className="mb-8 rounded-2xl border border-amber-500/20 bg-amber-950/5 p-5 text-amber-200 shadow-xl">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <Brain className="h-4 w-4 animate-bounce" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400">Behind Schedule System Warning</h4>
                  <div className="mt-2 space-y-2">
                    {tasks
                      .filter((t) => t.status === "Behind" && t.nudge)
                      .map((task) => (
                        <div key={task.id} className="text-sm bg-[#141414] rounded-xl p-4 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                          <div>
                            <span className="font-semibold block text-amber-400 text-xs uppercase mb-1">[Task: {task.title}]</span>
                            <span className="italic text-gray-300">"{task.nudge}"</span>
                          </div>
                          <button
                            onClick={() => {
                              const el = document.getElementById(`task-${task.id}`);
                              el?.scrollIntoView({ behavior: "smooth" });
                            }}
                            className="text-xs uppercase hover:underline text-indigo-400 font-semibold shrink-0"
                          >
                            Tackle Now
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            <div className="lg:col-span-5 space-y-6">
              
              <div className="rounded-2xl border border-white/5 bg-[#141414] p-6 shadow-xl relative">
                {/* Mode Selector Tabs */}
                <div className="flex border-b border-white/5 pb-4 mb-5 items-center justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Creator Mode</span>
                  <div className="flex gap-1.5 bg-[#0A0A0A] p-1 rounded-xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => setCreationMode("ai")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        creationMode === "ai"
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>AI Autopilot</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreationMode("manual")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        creationMode === "manual"
                          ? "bg-orange-500/20 text-orange-400"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      <ListPlus className="h-3.5 w-3.5" />
                      <span>Manual Blueprint</span>
                    </button>
                  </div>
                </div>

                {creationMode === "ai" ? (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-sm font-bold text-white tracking-tight">AI Roadmap Decomposer</h3>
                    </div>

                    <form onSubmit={handleAIBreakdown} className="space-y-4">
                      <div>
                        <label htmlFor="task-title-input" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Main Goals / Objectives</label>
                        <input
                          id="task-title-input"
                          type="text"
                          required
                          placeholder="e.g., Deploy GraphQL Server or secure Firestore routes"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        />
                      </div>

                      <div>
                        <label htmlFor="task-desc-input" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Architectural Specs (Optional)</label>
                        <textarea
                          id="task-desc-input"
                          placeholder="Detail packages, system behaviors, or integration rules..."
                          value={taskDesc}
                          onChange={(e) => setTaskDesc(e.target.value)}
                          className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 h-20 resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="task-deadline-input" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Target Deadline</label>
                          <input
                            id="task-deadline-input"
                            type="date"
                            required
                            value={taskDeadline}
                            onChange={(e) => setTaskDeadline(e.target.value)}
                            className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 focus:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 font-sans"
                          />
                        </div>

                        <div className="flex flex-col justify-end pb-1.5">
                          <label className={`relative flex items-center gap-2 select-none text-xs text-gray-300 ${accessToken ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                            <input
                              type="checkbox"
                              checked={autoCalendar && !!accessToken}
                              disabled={!accessToken}
                              onChange={(e) => setAutoCalendar(e.target.checked)}
                              className="h-4 w-4 rounded border-white/5 bg-[#0A0A0A] text-indigo-600 focus:ring-indigo-500/30"
                            />
                            <span className="font-semibold text-xs text-gray-300">Google Cal Scheduler</span>
                          </label>
                          {accessToken ? (
                            <p className="text-[10px] text-gray-500 mt-1 pl-6">Even schedule distribution across dates</p>
                          ) : (
                            <p 
                              onClick={handleLogin}
                              className="text-[10px] text-amber-500/90 hover:text-amber-400 mt-1 pl-6 text-left cursor-pointer transition-colors hover:underline"
                            >
                              Google Calendar is offline (Click to Connect)
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        id="trigger-breakdown-btn"
                        type="submit"
                        disabled={isGenerating || !taskTitle.trim()}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-indigo-700 active:scale-98 transition-colors disabled:opacity-50"
                      >
                        {isGenerating ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>Decomposing Tasks...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            <span>Decompose Tasks with AI</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <ListPlus className="h-4 w-4 text-orange-400" />
                      <h3 className="text-sm font-bold text-white tracking-tight">Construct Manual Blueprint</h3>
                    </div>

                    <form onSubmit={handleCreateTaskManually} className="space-y-4">
                      <div>
                        <label htmlFor="manual-title" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Main Goals / Objectives</label>
                        <input
                          id="manual-title"
                          type="text"
                          required
                          placeholder="e.g., Secure database connection pool"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                        />
                      </div>

                      <div>
                        <label htmlFor="manual-desc" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Architectural Specs (Optional)</label>
                        <textarea
                          id="manual-desc"
                          placeholder="Detail packages, system behaviors, or integration rules..."
                          value={taskDesc}
                          onChange={(e) => setTaskDesc(e.target.value)}
                          className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 h-20 resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="manual-priority" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Priority Level</label>
                          <select
                            id="manual-priority"
                            value={manualPriority}
                            onChange={(e) => setManualPriority(e.target.value as any)}
                            className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3 py-2 text-sm text-gray-100 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                          >
                            <option value="High">High Priority</option>
                            <option value="Medium">Medium Priority</option>
                            <option value="Low">Low Priority</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="manual-estimate" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Time Estimate</label>
                          <input
                            id="manual-estimate"
                            type="text"
                            required
                            placeholder="e.g., 4 hours, 1 day"
                            value={manualTimeEstimate}
                            onChange={(e) => setManualTimeEstimate(e.target.value)}
                            className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                          />
                        </div>
                      </div>

                      <div className="border-t border-white/5 pt-4">
                        <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Blueprint Subtask Roadmap</label>
                        
                        <div className="flex gap-2 mb-3">
                          <input
                            type="text"
                            placeholder="Add subtask step (press Enter or click +)"
                            value={newSubtaskTitle}
                            onChange={(e) => setNewSubtaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                if (newSubtaskTitle.trim()) {
                                  setManualSubtasks(prev => [...prev, newSubtaskTitle.trim()]);
                                  setNewSubtaskTitle("");
                                }
                              }
                            }}
                            className="flex-1 rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (newSubtaskTitle.trim()) {
                                setManualSubtasks(prev => [...prev, newSubtaskTitle.trim()]);
                                setNewSubtaskTitle("");
                              }
                            }}
                            className="flex items-center justify-center p-2 rounded-lg border border-white/5 bg-[#0A0A0A] text-orange-400 hover:text-white hover:bg-white/5 transition-all h-[38px] w-[38px] shrink-0"
                            title="Add subtask step"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>

                        {manualSubtasks.length > 0 ? (
                          <div className="space-y-1.5 max-h-40 overflow-y-auto mb-3 pr-1">
                            {manualSubtasks.map((st, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-orange-500/5 border border-orange-500/10 text-xs text-gray-300">
                                <span className="truncate">{idx + 1}. {st}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveManualSubtask(idx)}
                                  className="text-gray-500 hover:text-rose-400 transition-colors shrink-0"
                                  title="Remove step"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500 italic mb-3">No steps added yet. Add at least one milestone above.</p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-white/5 pt-4">
                        <div>
                          <label htmlFor="manual-deadline" className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Target Deadline</label>
                          <input
                            id="manual-deadline"
                            type="date"
                            required
                            value={taskDeadline}
                            onChange={(e) => setTaskDeadline(e.target.value)}
                            className="w-full rounded-lg border border-white/5 bg-[#0A0A0A] px-3.5 py-2 text-sm text-gray-100 focus:border-orange-500/50 focus:outline-none focus:ring-1 focus:ring-orange-500/50 font-sans"
                          />
                        </div>

                        <div className="flex flex-col justify-end pb-1.5">
                          <label className={`relative flex items-center gap-2 select-none text-xs text-gray-300 ${accessToken ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                            <input
                              type="checkbox"
                              checked={autoCalendar && !!accessToken}
                              disabled={!accessToken}
                              onChange={(e) => setAutoCalendar(e.target.checked)}
                              className="h-4 w-4 rounded border-white/5 bg-[#0A0A0A] text-orange-500 focus:ring-orange-500/30"
                            />
                            <span className="font-semibold text-xs text-gray-300">Google Cal Scheduler</span>
                          </label>
                          {accessToken ? (
                            <p className="text-[10px] text-gray-500 mt-1 pl-6">Even schedule distribution across dates</p>
                          ) : (
                            <p 
                              onClick={handleLogin}
                              className="text-[10px] text-amber-500/90 hover:text-amber-400 mt-1 pl-6 text-left cursor-pointer transition-colors hover:underline"
                            >
                              Google Calendar is offline (Click to Connect)
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={!taskTitle.trim() || manualSubtasks.length === 0}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-orange-500 active:scale-98 transition-colors disabled:opacity-50"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Assemble Manual Blueprint</span>
                      </button>
                    </form>
                  </div>
                )}

                {generationError && (
                  <div className="mt-4 rounded-xl bg-orange-500/5 border border-orange-500/20 p-3.5 text-xs text-amber-300">
                    <p className="font-semibold mb-1">AI Recommendation Limits</p>
                    <p>{generationError}</p>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {tempBreakdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    className="rounded-2xl border border-white/5 bg-[#141414] p-6 shadow-xl space-y-4 relative overflow-hidden"
                  >
                    <div className="absolute right-0 top-0 h-24 w-24 bg-indigo-500/5 rounded-full blur-2xl -z-10" />

                    <div className="flex items-center justify-between border-b border-white/5 pb-3">
                      <span className="font-sans text-xs text-indigo-400 uppercase tracking-wider flex items-center gap-1.5 font-bold">
                        <Brain className="h-4 w-4" /> AI Draft Proposal
                      </span>
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                        tempBreakdown.priority === "High" ? "bg-red-500/10 border-red-500/20 text-red-400" :
                        tempBreakdown.priority === "Medium" ? "bg-amber-500/10 border-amber-500/20 text-amber-400" :
                        "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                      }`}>
                        {tempBreakdown.priority} priority
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Developer Cost Estimate</p>
                      <p className="text-lg font-semibold text-white flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-gray-400" /> {tempBreakdown.timeEstimate}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-900/40 to-transparent border border-indigo-500/20">
                      <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider flex items-center gap-1 mb-1">
                        <Lightbulb className="h-3.5 w-3.5 shrink-0" /> Immediate Procrastination Fix
                      </p>
                      <p className="text-sm font-medium text-gray-200 mt-1 italic">"{tempBreakdown.firstStep}"</p>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">Generated Roadmap Steps</p>
                      <ul className="space-y-2">
                        {tempBreakdown.subtasks.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2.5 text-sm text-gray-300">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] font-bold text-gray-400">
                              0{idx + 1}
                            </span>
                            <span className="mt-0.5">{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mb-2">5-Min Momentum Triggers</p>
                      <ul className="space-y-2">
                        {tempBreakdown.startNowPlan.map((step, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                            <span className="text-indigo-400 mt-0.5">•</span>
                            <span className="italic">"{step}"</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-2 border-t border-white/5 flex items-center gap-3">
                      <button
                        onClick={handleCommitTask}
                        className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/10 hover:bg-indigo-700 active:scale-98 transition-all"
                      >
                        <Plus className="h-4 w-4" />
                        <span>Deploy to Workspace</span>
                      </button>
                      <button
                        onClick={() => setTempBreakdown(null)}
                        className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-gray-400 hover:text-white transition-colors"
                        title="Discard Draft"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </div>

            <div className="lg:col-span-7 space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <LayoutDashboard className="h-5 w-5 text-indigo-400" /> Task Pipeline
                </h3>

                <div className="flex bg-[#0F0F0F] border border-white/5 p-1 rounded-xl text-xs flex-wrap gap-1">
                  {(["All", "Behind", "On Track", "Completed"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setCurrentFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                        currentFilter === filter 
                          ? "bg-white/5 text-indigo-400 border border-white/10" 
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {loadingTasks && tasks.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
                  <p className="text-xs text-gray-500 font-mono">SYNCHRONIZING BOARD STATE...</p>
                </div>
              )}

              {!loadingTasks && filteredTasks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-gray-400 bg-[#141414]/20">
                  <Plus className="mx-auto h-8 w-8 mb-3 text-gray-600" />
                  <p className="text-sm">No workspace items found matching metadata.</p>
                  <p className="text-xs mt-1">Submit your next major goal on the left decomposer to draft an AI plan.</p>
                </div>
              )}

              <div className="space-y-4">
                {filteredTasks.map((task) => {
                  const isExpanded = expandedTasks[task.id] ?? false;
                  const isBehind = task.status === "Behind";
                  const isCompleted = task.progress === 100;

                  return (
                    <div
                      key={task.id}
                      id={`task-${task.id}`}
                      className={`bg-[#141414] border rounded-2xl transition-all duration-300 text-left overflow-hidden ${
                        isBehind ? "border-red-500/25 shadow-lg shadow-red-950/5 hover:border-red-500/40" :
                        isCompleted ? "border-white/5 opacity-80 hover:opacity-100" :
                        "border-white/5 hover:border-indigo-500/50"
                      }`}
                    >
                      <div 
                        className="p-6 flex items-start justify-between gap-4 cursor-pointer select-none"
                        onClick={() => handleToggleExpandTask(task.id)}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex flex-wrap items-center gap-3 mb-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              task.priority === "High" ? "bg-red-500/10 text-red-500 border-red-500/20" :
                              task.priority === "Medium" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                              "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                            }`}>
                              {task.priority} Priority
                            </span>
                            
                            <div className="flex items-center gap-1 text-gray-500 text-xs">
                              <Clock className="w-3.5 h-3.5" />
                              <span>Est: {task.timeEstimate}</span>
                            </div>

                            {task.deadline && (
                              <div className="flex items-center gap-1 text-gray-500 text-xs">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>Due: {task.deadline}</span>
                              </div>
                            )}
                          </div>

                          <h4 className={`text-lg font-medium tracking-tight truncate ${isCompleted ? 'text-gray-500 line-through' : 'text-white'}`}>
                            {task.title}
                          </h4>
                          {task.description && (
                            <p className="text-sm text-gray-400 mt-1.5 truncate max-w-xl font-light">
                              {task.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-4 shrink-0 self-center">
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="w-24 bg-white/5 h-2 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isCompleted ? 'bg-emerald-500' : isBehind ? 'bg-red-500' : 'bg-indigo-500'
                                }`}
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">{task.progress}% Complete</span>
                          </div>

                          <div className="hidden sm:flex items-center gap-2">
                            {!isCompleted && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveFocusTaskId(task.id);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 hover:border-orange-500/30 transition-all shrink-0 shadow-sm"
                                title="Start a distraction-free focus session"
                              >
                                <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" />
                                <span>Start Focus</span>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(task);
                              }}
                              className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                              title="Delete task from workspace"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <div className="p-1 text-gray-400 hover:text-white">
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: "auto" }}
                            exit={{ height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="border-t border-white/5 bg-[#0F0F0F]/40"
                          >
                            <div className="p-5 border-b border-white/5 space-y-6">
                              
                              {task.description && (
                                <div className="space-y-1.5">
                                  <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Architectural Constraints</p>
                                  <p className="text-sm text-gray-300 font-light leading-relaxed">{task.description}</p>
                                </div>
                              )}

                              <div className={`p-5 rounded-2xl border flex flex-col md:flex-row items-start justify-between gap-4 ${
                                isBehind 
                                  ? "bg-[#1A1112] border-red-500/15 text-red-200" 
                                  : "bg-indigo-500/5 border-white/5 text-indigo-200"
                              }`}>
                                <div className="flex-1 flex gap-3">
                                  <div className="mt-0.5">
                                    <Brain className={`h-5 w-5 ${isBehind ? "text-red-400 animate-pulse" : "text-indigo-400"}`} />
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold block uppercase tracking-wider mb-1">
                                      🤖 AI Decomposer {isBehind ? "Priority Intervention" : "Coaching Target"}
                                    </span>
                                    <p className="text-sm font-light italic leading-relaxed">
                                      {task.nudge ?? `"${task.firstStep}" - Start here first to crush hesitation.`}
                                    </p>
                                  </div>
                                </div>
                                
                                <div className="flex flex-col sm:flex-row gap-2 self-end md:self-center shrink-0">
                                  {!isCompleted && (
                                    <button
                                      onClick={() => setActiveFocusTaskId(task.id)}
                                      className="flex items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 px-3.5 py-1.5 text-xs font-semibold text-orange-400 transition-colors shrink-0"
                                    >
                                      <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" />
                                      <span>Start Now</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleRegenerateNudge(task)}
                                    disabled={nudgeLoading[task.id]}
                                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#141414] px-3.5 py-1.5 text-xs font-semibold text-gray-300 hover:text-white transition-colors disabled:opacity-50 shrink-0"
                                  >
                                    {nudgeLoading[task.id] ? (
                                      <>
                                        <RefreshCw className="h-3 w-3 animate-spin" />
                                        <span>Evaluating...</span>
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw className="h-3 w-3" />
                                        <span>Request Nudge</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              {nudgeErrors[task.id] && (
                                <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 p-3 text-xs text-amber-300">
                                  <p className="font-semibold mb-0.5">Nudge limit reached</p>
                                  <p className="font-light">{nudgeErrors[task.id]}</p>
                                </div>
                              )}

                              <div className="space-y-3">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 flex items-center gap-1.5">
                                  <CheckSquare className="h-3.5 w-3.5 text-indigo-400" /> Tactical Roadmap Subtasks
                                </p>
                                <div className="space-y-2">
                                  {task.subtasks.map((st) => (
                                    <label
                                      key={st.id}
                                      className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors cursor-pointer select-none ${
                                        st.completed 
                                          ? "border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10" 
                                          : "border-white/5 bg-[#0F0F0F] hover:bg-[#141414]"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={st.completed}
                                        onChange={() => handleToggleSubtask(task, st.id)}
                                        className="mt-1 h-4 w-4 bg-[#0A0A0A] border-white/10 text-indigo-600 rounded"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-medium ${st.completed ? "text-gray-500 line-through" : "text-gray-200"}`}>
                                          {st.title}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                          {st.scheduledTime && (
                                            <span className="font-mono text-[9px] text-gray-500 flex items-center gap-1.5">
                                              <Calendar className="h-3 w-3" /> Agenda Time: {st.scheduledTime}
                                            </span>
                                          )}
                                          {st.calendarEventId && (
                                            <span className="text-[9px] text-indigo-400 font-semibold bg-indigo-500/5 px-1.5 py-0.5 rounded border border-indigo-500/10">
                                              Google Cal Sync Active
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-3 pt-2">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 flex items-center gap-1.5">
                                  <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" /> Inertia Crusher: 5-Min Momentum Targets
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  {task.startNowPlan.map((step, idx) => (
                                    <div key={idx} className="rounded-xl border border-white/5 bg-[#0F0F0F] p-4 flex flex-col justify-between">
                                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">MOMENTUM_STAGE_0{idx + 1}</span>
                                      <p className="text-xs text-gray-300 mt-2.5 italic">"{step}"</p>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="sm:hidden pt-4 border-t border-white/5 flex justify-end">
                                <button
                                  onClick={() => handleDeleteTask(task)}
                                  className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition-all"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Decommission Task</span>
                                </button>
                              </div>

                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

            </div>

          </div>

        </div>
      )}

      {/* 4. Focus Mode Fullscreen Distraction-free Overlay */}
      <AnimatePresence>
        {activeFocusTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#070708]/98 backdrop-blur-xl flex flex-col justify-between p-6 sm:p-12 text-gray-100 selection:bg-orange-500 selection:text-white"
          >
            {/* Background ambient glowing blob */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-10 h-[500px] w-[500px] rounded-full bg-orange-500/5 blur-[120px] animate-pulse" />

            {/* Top Bar */}
            <div className="flex items-center justify-between gap-4 max-w-5xl mx-auto w-full border-b border-white/5 pb-6">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-ping shrink-0" />
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400">Distraction-Free Focus Session</span>
                  <h2 className="text-sm font-semibold text-gray-400 truncate max-w-md sm:max-w-xl">
                    {activeFocusTask.title}
                  </h2>
                </div>
              </div>
              <button
                onClick={() => setActiveFocusTaskId(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 hover:text-white transition-all focus:outline-none"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Exit Focus</span>
              </button>
            </div>

            {/* Middle Section: Big Display of Current Actionable Step */}
            <div className="flex-1 flex flex-col items-center justify-center text-center max-w-3xl mx-auto w-full my-8">
              {(() => {
                const nextStep = activeFocusTask.subtasks.find(st => !st.completed);
                const totalSteps = activeFocusTask.subtasks.length;
                const completedStepsCount = activeFocusTask.subtasks.filter(st => st.completed).length;

                if (!nextStep) {
                  return (
                    <div className="space-y-6">
                      <div className="mx-auto w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center animate-bounce">
                        <CheckCircle2 className="h-8 w-8" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-3xl font-bold tracking-tight text-white">All Subtasks Completed!</h3>
                        <p className="text-gray-400 max-w-md mx-auto font-light leading-relaxed">
                          Fantastic work! You have cleared this roadmap. Exit focus mode to declare your next mission.
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveFocusTaskId(null)}
                        className="mt-4 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition-all focus:outline-none shadow-lg shadow-indigo-950/40"
                      >
                        Return to Pipeline
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="space-y-8 w-full">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-orange-500/10 bg-orange-500/5 text-orange-400 text-xs font-semibold uppercase tracking-widest animate-pulse">
                      <Flame className="h-3 w-3" /> Current Tactical Target
                    </div>

                    <div className="space-y-3 px-4">
                      <h3 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
                        {nextStep.title}
                      </h3>
                      <p className="text-sm text-gray-500 font-mono tracking-wide">
                        ESTIMATED TOTAL SESSION: {activeFocusTask.timeEstimate}
                      </p>
                    </div>

                    <div className="pt-4 flex flex-col items-center gap-4">
                      <button
                        onClick={() => handleToggleSubtask(activeFocusTask, nextStep.id)}
                        className="group flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-orange-500 hover:bg-orange-400 text-black font-extrabold text-base transition-all shadow-xl shadow-orange-950/20 transform hover:-translate-y-0.5 active:translate-y-0"
                      >
                        <CheckCircle2 className="h-5 w-5 stroke-[2.5px]" />
                        <span>Complete & Next Step</span>
                      </button>

                      {activeFocusTask.startNowPlan && activeFocusTask.startNowPlan.length > 0 && (
                        <div className="max-w-lg mt-4 p-4 rounded-xl border border-white/5 bg-[#141416]/60 backdrop-blur text-left space-y-2">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                            <Lightbulb className="h-3.5 w-3.5 text-amber-400" /> Friction Reducer: 5-Min Starting Plan
                          </p>
                          <p className="text-xs text-gray-300 italic">
                            "{activeFocusTask.startNowPlan[0]}"
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Bottom Bar: Progress Indicator */}
            <div className="max-w-5xl mx-auto w-full border-t border-white/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              {(() => {
                const totalSteps = activeFocusTask.subtasks.length;
                const completedStepsCount = activeFocusTask.subtasks.filter(st => st.completed).length;
                const progressPercentage = totalSteps > 0 ? Math.round((completedStepsCount / totalSteps) * 100) : 0;

                return (
                  <>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="w-full sm:w-48 bg-white/5 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 rounded-full transition-all duration-500"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono font-bold text-gray-400 shrink-0">
                        {completedStepsCount}/{totalSteps} TARGETS DONE ({progressPercentage}%)
                      </span>
                    </div>

                    <div className="text-right hidden sm:block">
                      <span className="text-xs text-gray-500 font-medium">
                        Keyboard Hint: Click "Complete" to step forward instantly.
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}