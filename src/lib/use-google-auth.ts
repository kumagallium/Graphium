// Google 認証の React Hook

import { useEffect, useState } from "react";
import {
  initGoogleAuth,
  signIn as gisSignIn,
  signOut as gisSignOut,
  isSignedIn,
  onAuthChange,
} from "./google-auth";
import { clearCache } from "./google-drive";

export function useGoogleAuth() {
  const [authenticated, setAuthenticated] = useState(isSignedIn());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initGoogleAuth().then(() => setLoading(false));
    const unsubscribe = onAuthChange((token) => {
      setAuthenticated(token !== null);
    });
    return unsubscribe;
  }, []);

  const signIn = () => gisSignIn();
  const signOut = () => {
    gisSignOut();
    clearCache();
  };

  return { authenticated, loading, signIn, signOut };
}
