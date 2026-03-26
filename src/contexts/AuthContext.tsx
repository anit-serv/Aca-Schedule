import { createContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
  reload,
  updatePassword,
  EmailAuthProvider,
  linkWithCredential,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import type { AppUser } from '../types';
import { userService } from '../services/firestore';
import { authRegistrationService } from '../services/authRegistration';

interface AuthContextType {
  currentUser: AppUser | null;
  firebaseUser: User | null;
  loading: boolean;
  needsPasswordSetup: boolean;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resendRegistrationEmail: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  setPasswordForCurrentUser: (password: string) => Promise<void>;
  refreshFirebaseUser: () => Promise<void>;
  logout: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  const hasPasswordProvider = (user: User) =>
    user.providerData.some((provider) => provider.providerId === 'password');

  const isGoogleUser = (user: User) =>
    user.providerData.some((provider) => provider.providerId === 'google.com');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // Googleログインユーザーは、password provider未連携なら必ずパスワード設定を要求する。
        setNeedsPasswordSetup(isGoogleUser(user) && !hasPasswordProvider(user));

        const appUser: AppUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date(user.metadata.creationTime || Date.now()),
        };
        setCurrentUser(appUser);
        // Firestoreにユーザー情報を保存/更新（失敗してもloadingを解除する）
        try {
          await userService.saveUser(appUser);
        } catch (err) {
          console.error('[AuthContext] ユーザー情報の保存に失敗しました:', err);
        }
      } else {
        setCurrentUser(null);
        setNeedsPasswordSetup(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithEmail = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await reload(credential.user);

    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      await signOut(auth);
      const error = new Error('メールアドレスが未確認です。確認メールを再送しました。');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error as any).code = 'auth/email-not-verified';
      throw error;
    }

    const idToken = await credential.user.getIdToken();
    await authRegistrationService.confirmRegistration(idToken);
  };

  const registerWithEmail = async (email: string, password: string, displayName: string) => {
    await authRegistrationService.registerPending(email, password, displayName);
  };

  const resendRegistrationEmail = async (email: string) => {
    await authRegistrationService.resendRegistration(email);
  };

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const refreshFirebaseUser = async () => {
    if (!auth.currentUser) return;
    await reload(auth.currentUser);
    setFirebaseUser(auth.currentUser);
    setNeedsPasswordSetup(isGoogleUser(auth.currentUser) && !hasPasswordProvider(auth.currentUser));
  };

  const setPasswordForCurrentUser = async (password: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) {
      throw new Error('ログイン状態が無効です。再ログインしてください。');
    }

    if (!hasPasswordProvider(user)) {
      const credential = EmailAuthProvider.credential(user.email, password);
      await linkWithCredential(user, credential);
    } else {
      await updatePassword(user, password);
    }

    await reload(user);
    setFirebaseUser(user);
    setNeedsPasswordSetup(false);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        firebaseUser,
        loading,
        needsPasswordSetup,
        loginWithEmail,
        registerWithEmail,
        resendRegistrationEmail,
        loginWithGoogle,
        setPasswordForCurrentUser,
        refreshFirebaseUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
