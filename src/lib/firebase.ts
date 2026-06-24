import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, AuthProvider, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Provider with Google Calendar scopes
export const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/calendar");
provider.addScope("https://www.googleapis.com/auth/calendar.events");

let isSigningIn = false;
let cachedAccessToken: string | null = typeof window !== "undefined" ? sessionStorage.getItem("gcal_access_token") : null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  // Immediately succeed with a local developer identity to bypass any Firebase Auth service restrictions
  setTimeout(() => {
    if (onAuthSuccess) {
      onAuthSuccess({
        uid: "local-developer",
        email: "local@example.com",
        displayName: "Local Developer",
        photoURL: null,
      } as any, null);
    }
  }, 0);
  return () => {};
};

// Log in via Google Sign In
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to retrieve Google Access Token.");
    }
    cachedAccessToken = credential.accessToken;
    sessionStorage.setItem("gcal_access_token", cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign-in process failed:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Access Token Retrieval
export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    cachedAccessToken = sessionStorage.getItem("gcal_access_token");
  }
  return cachedAccessToken;
};

// Logout Functionality
export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  sessionStorage.removeItem("gcal_access_token");
};

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { app };