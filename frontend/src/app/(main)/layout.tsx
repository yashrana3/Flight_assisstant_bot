import Header from "../../components/Header";
import FeedbackWidget from "@/components/FeedbackWidget";
import { ProfileCompletionProvider } from "@/components/onboarding/ProfileCompletionProvider";
import { ProfileCompletionBanner } from "@/components/onboarding/ProfileCompletionBanner";

export default function MainLayout({ children }: { children: React.ReactNode }) {
    return (
        <ProfileCompletionProvider>
            <div className="min-h-screen flex flex-col">
                <Header />
                <ProfileCompletionBanner />
                {children}
                <FeedbackWidget />
            </div>
        </ProfileCompletionProvider>
    );
}
