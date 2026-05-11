export default function AuthLayout({ children }: { children: React.ReactNode }) {
    // No Header for auth pages
    return <>{children}</>;
}
