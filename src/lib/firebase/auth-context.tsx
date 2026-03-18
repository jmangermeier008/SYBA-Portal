/**
 * @deprecated
 * This file is legacy. Use @/firebase/auth/use-user instead.
 */
export const AuthProvider = ({ children }: { children: React.ReactNode }) => children;
export const useAuth = () => ({ user: null, profile: null, loading: false });
