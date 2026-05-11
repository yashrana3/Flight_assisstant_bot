import { Suspense } from "react";
import ChatClient from "./ChatClient";

export default async function ChatPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const resolvedParams = await searchParams;
    const q = typeof resolvedParams?.q === "string" ? resolvedParams.q : "";
    return (
        <Suspense fallback={<div className="flex-1 bg-white" />}>
            <ChatClient initialQuery={q} />
        </Suspense>
    );
}
