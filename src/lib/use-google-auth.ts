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
    initGoogleAuth().then(() => {
      // リダイレクト認証完了後、リスナー登録前に状態が変わっている可能性がある
      setAuthenticated(isSignedIn());
      setLoading(false);
    });
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
