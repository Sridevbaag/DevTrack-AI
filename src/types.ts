export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  calendarEventId?: string;
  scheduledTime?: string; // ISO String
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low';
  timeEstimate: string;
  firstStep: string;
  startNowPlan: string[];
  subtasks: Subtask[];
  deadline: string; // YYYY-MM-DD
  createdTime: string; // ISO String
  progress: number; // 0 to 100
  status: 'On Track' | 'Behind' | 'Completed';
  nudge: string | null;
  nudgeTime: string | null;
}
