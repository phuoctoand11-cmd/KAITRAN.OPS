import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, SUPABASE_ANON_KEY_LOADED, SUPABASE_URL_FOR_DEBUG } from "./supabase";

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** true when there is a signed-in session — the app's only permission check. */
  canManage: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SESSION_INIT_TIMEOUT_MS = 5000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      // eslint-disable-next-line no-console
      console.info("[auth] init start", {
        url: SUPABASE_URL_FOR_DEBUG,
        anonKeyLoaded: SUPABASE_ANON_KEY_LOADED,
      });

      try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("getSession timed out after 5s")),
            SESSION_INIT_TIMEOUT_MS
          )
        );

        const { data } = await Promise.race([sessionPromise, timeoutPromise]) as Awaited<typeof sessionPromise>;

        if (!mountedRef.current) return;
        setSession(data.session);
        setLoading(false);
      } catch (err) {
        if (!mountedRef.current) return;
        // eslint-disable-next-line no-console
        console.error("[auth] init failed", err instanceof Error ? err.message : err);
        setLoading(false);
      }
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mountedRef.current) return;
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      mountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      canManage: !!session,
      signIn,
      signOut,
    }),
    [loading, session, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
