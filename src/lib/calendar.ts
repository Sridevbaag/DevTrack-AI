import { Subtask, Task } from "../types";

/**
 * Creates a single Google Calendar event for a subtask on a specific date.
 */
export async function createCalendarEvent(
  accessToken: string,
  taskTitle: string,
  subtaskTitle: string,
  scheduledDateStr: string,
  timeEstimate: string
): Promise<string | null> {
  try {
    const startDateTime = `${scheduledDateStr}T10:00:00`;
    const endDateTime = `${scheduledDateStr}T11:00:00`;

    const body = {
      summary: `🎯 DevTrack AI: ${subtaskTitle}`,
      description: `Plan for Task: "${taskTitle}"\nTime estimate: ${timeEstimate}\nCreated by DevTrack AI.`,
      start: {
        dateTime: startDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      end: {
        dateTime: endDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
      reminders: {
        useDefault: true,
      },
    };

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("GCal Create Event API Error:", errText);
      return null;
    }

    const data = await response.json();
    return data.id ?? null;
  } catch (error) {
    console.error("Error creating Google Calendar Event:", error);
    return null;
  }
}

/**
 * Synchronizes the status of a subtask to Google Calendar (prefixes with ✅ Completed or re-adds prefix).
 */
export async function updateCalendarEventStatus(
  accessToken: string,
  eventId: string,
  subtaskTitle: string,
  completed: boolean
): Promise<boolean> {
  try {
    // First, fetch the current event to preserve times/description
    const getRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!getRes.ok) {
      console.warn("Could not find GCal event to update:", eventId);
      return false;
    }

    const eventObj = await getGetJson(getRes);
    const cleanTitle = subtaskTitle.replace(/^✅\s*|❌\s*|🎯\s*/, "");
    eventObj.summary = completed 
      ? `✅ DevTrack AI [Completed]: ${cleanTitle}`
      : `🎯 DevTrack AI: ${cleanTitle}`;

    const patchRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventObj),
      }
    );

    return patchRes.ok;
  } catch (error) {
    console.error("Error updating Google Calendar event status:", error);
    return false;
  }
}

/**
 * Deletes a Google Calendar event.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    return response.ok;
  } catch (error) {
    console.error("Error deleting Google Calendar Event:", error);
    return false;
  }
}

// Safely parse JSON from a Response object
async function getGetJson(res: Response): Promise<any> {
  return await res.json();
}
