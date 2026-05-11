"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Upload, Eye, Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const tabs = ["All", "Passport", "Visa", "Insurance", "Booking"];

type DocType = "Passport" | "Visa" | "Insurance" | "Booking";

type UploadedDocImage = {
    id: string;
    docType: DocType;
    fileName: string | null;
    imageBase64: string;
    objectUrl: string;
};

function getDocTypeStyle(docType: DocType) {
    switch (docType) {
        case "Passport":
            return "bg-[#DBEAFE] text-[#1D4ED8]";
        case "Visa":
            return "bg-[#FEF3C7] text-[#92400E]";
        case "Insurance":
            return "bg-[#D1FAE5] text-[#065F46]";
        case "Booking":
            return "bg-[#E9D5FF] text-[#6D28D9]";
        default:
            return "bg-[#F3F4F6] text-[#374151]";
    }
}

export default function DocumentVaultPage() {
    const [activeTab, setActiveTab] = useState("All");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [uploadDocType, setUploadDocType] = useState<DocType>("Passport");
    const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const [vaultImages, setVaultImages] = useState<UploadedDocImage[]>([]);
    const [isLoadingVault, setIsLoadingVault] = useState(false);
    const [isUploadingToDb, setIsUploadingToDb] = useState(false);
    const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
    const [preview, setPreview] = useState<UploadedDocImage | null>(null);
    const [editingDoc, setEditingDoc] = useState<UploadedDocImage | null>(null);
    const [editDocType, setEditDocType] = useState<DocType>("Passport");
    const [editFileName, setEditFileName] = useState("");
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const closeUploadModal = () => {
        setIsUploadModalOpen(false);
        setSelectedFileName(null);
        setSelectedFile(null);
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const maxBytes = 100 * 1024; // 100KB
        if (file.size > maxBytes) {
            toast.error("File too large. Max allowed size is 100KB.");
            // Reset the input so the user must pick a valid file again.
            e.target.value = "";
            return;
        }

        const allowedExt = new Set(["jpg", "jpeg"]);
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (!allowedExt.has(ext)) {
            toast.error("Invalid file type. Only .jpg and .jpeg are allowed.");
            e.target.value = "";
            return;
        }

        // Extra safety: mime type should be JPEG if extension is correct.
        if (file.type !== "image/jpeg") {
            toast.error("Invalid file type. Only .jpg and .jpeg are allowed.");
            e.target.value = "";
            return;
        }

        setSelectedFileName(file.name);
        setSelectedFile(file);
        toast.success(`Selected: ${file.name}`);

        // Next step (server + DB): compress + upload + show in View button.
        // For now, we only make the upload button functional (opens file picker).
    };

    const handleUploadClick = () => {
        setIsUploadModalOpen(true);
        setSelectedFileName(null);
        setSelectedFile(null);
    };

    const handleChooseFileClick = () => {
        fileInputRef.current?.click();
    };

    const loadVaultImages = async () => {
        setIsLoadingVault(true);
        try {
            const res = await fetch("/api/document-vault", { cache: "no-store" });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.detail ?? "Failed to load uploaded documents.");
            }

            type VaultApiImage = {
                id: string;
                docType: DocType | string;
                fileName: string | null;
                imageBase64: string;
            };

            const rawImages = (data?.images ?? []) as VaultApiImage[];
            const mapped: UploadedDocImage[] = rawImages.map((img) => {
                const objectUrl = `data:image/jpeg;base64,${img.imageBase64}`;
                return {
                    id: img.id,
                    docType: img.docType as DocType,
                    fileName: img.fileName,
                    imageBase64: img.imageBase64,
                    objectUrl,
                };
            });

            setVaultImages(mapped);
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to load uploaded documents.",
            );
            setVaultImages([]);
        } finally {
            setIsLoadingVault(false);
        }
    };

    useEffect(() => {
        void loadVaultImages();
    }, []);

    async function compressJpegUnderMaxToBase64(
        file: File,
        maxBytes: number,
    ): Promise<string> {
        const maxDim = 1200;

        const imgUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error("Failed to load image."));
                image.src = imgUrl;
            });

            const scale = Math.min(
                1,
                maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1),
            );
            const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
            const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

            const canvas = document.createElement("canvas");
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas not supported.");

            // Ensure white background (JPEG has no alpha).
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, targetW, targetH);
            ctx.drawImage(img, 0, 0, targetW, targetH);

            const qualitySteps = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25];

            const canvasToJpegBlob = (quality: number) =>
                new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(
                        (b) => {
                            if (!b) return reject(new Error("Compression failed."));
                            resolve(b);
                        },
                        "image/jpeg",
                        quality,
                    );
                });

            let lastBlob: Blob | null = null;
            for (const q of qualitySteps) {
                const blob = await canvasToJpegBlob(q);
                lastBlob = blob;
                if (blob.size <= maxBytes) {
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const dataUrl = String(reader.result || "");
                            const base64Only = dataUrl.includes(",")
                                ? dataUrl.split(",", 2)[1]
                                : dataUrl;
                            resolve(base64Only);
                        };
                        reader.onerror = () => reject(new Error("Failed to read compressed image."));
                        reader.readAsDataURL(blob);
                    });
                    return base64;
                }
            }

            if (lastBlob && lastBlob.size <= maxBytes) {
                // Shouldn't happen (we would have returned), but keep safe.
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const dataUrl = String(reader.result || "");
                        const base64Only = dataUrl.includes(",")
                            ? dataUrl.split(",", 2)[1]
                            : dataUrl;
                        resolve(base64Only);
                    };
                    reader.onerror = () => reject(new Error("Failed to read compressed image."));
                    reader.readAsDataURL(lastBlob as Blob);
                });
                return base64;
            }

            throw new Error(
                "Could not compress the image under 100KB. Please try another file.",
            );
        } finally {
            URL.revokeObjectURL(imgUrl);
        }
    }

    const handleUploadToDb = async () => {
        if (!selectedFileName || !selectedFile) {
            toast.error("Choose a file first.");
            return;
        }

        setIsUploadingToDb(true);
        const toastId = toast.loading("Uploading document…");
        try {
            const base64 = await compressJpegUnderMaxToBase64(
                selectedFile,
                100 * 1024,
            );

            const res = await fetch("/api/document-vault", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    docType: uploadDocType,
                    fileName: selectedFileName,
                    mimeType: "image/jpeg",
                    imageBase64: base64,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.detail ?? "Upload failed.");
            }

            toast.success("Document uploaded.", { id: toastId });
            closeUploadModal();
            await loadVaultImages();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Upload failed.",
                { id: toastId },
            );
        } finally {
            setIsUploadingToDb(false);
        }
    };

    const visibleImages =
        activeTab === "All"
            ? vaultImages
            : vaultImages.filter((d) => d.docType === activeTab);

    const closePreview = () => {
        setIsPreviewModalOpen(false);
        setPreview(null);
    };

    const openEditModal = (doc: UploadedDocImage) => {
        setEditingDoc(doc);
        setEditDocType(doc.docType);
        setEditFileName(doc.fileName ?? "");
    };

    const closeEditModal = () => {
        setEditingDoc(null);
        setEditFileName("");
        setEditDocType("Passport");
    };

    const handleDownload = (doc: UploadedDocImage) => {
        const a = document.createElement("a");
        a.href = doc.objectUrl;
        a.download = doc.fileName ?? "document.jpg";
        a.click();
    };

    const handleDelete = async (doc: UploadedDocImage) => {
        if (!window.confirm(`Delete ${doc.fileName ?? "this document"}?`)) return;
        try {
            const res = await fetch(`/api/document-vault/${encodeURIComponent(doc.id)}`, {
                method: "DELETE",
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.detail ?? "Failed to delete document.");
            toast.success("Document deleted.");
            setVaultImages((prev) => prev.filter((item) => item.id !== doc.id));
            if (preview?.id === doc.id) closePreview();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete document.");
        }
    };

    const handleSaveEdit = async () => {
        if (!editingDoc) return;
        if (!editFileName.trim()) {
            toast.error("File name is required.");
            return;
        }
        setIsSavingEdit(true);
        try {
            const res = await fetch(`/api/document-vault/${encodeURIComponent(editingDoc.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ docType: editDocType, fileName: editFileName.trim() }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.detail ?? "Failed to update document.");
            setVaultImages((prev) =>
                prev.map((item) =>
                    item.id === editingDoc.id
                        ? { ...item, docType: editDocType, fileName: editFileName.trim() }
                        : item,
                ),
            );
            toast.success("Document updated.");
            closeEditModal();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update document.");
        } finally {
            setIsSavingEdit(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
                <div style={{ animation: "fadeIn 0.5s ease-out" }}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center">
                                    <FolderOpen className="w-5 h-5 text-[#1D4ED8]" />
                                </div>
                                <h1 className="text-[#0A2140]" style={{ fontSize: "24px", fontWeight: "700" }}>
                                    Document Vault
                                </h1>
                            </div>
                            <p className="text-[#6B7280] text-sm sm:text-base sm:ml-[52px]">
                                Securely store and manage your travel documents
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleUploadClick}
                            className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
                        >
                            <Upload className="w-4 h-4" />
                            Upload
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".jpg,.jpeg,image/jpeg"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </div>

                    {isUploadModalOpen && (
                        <div
                            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                            role="dialog"
                            aria-modal="true"
                            onClick={closeUploadModal}
                        >
                            <div
                                className="w-full max-w-md bg-white rounded-2xl border border-[#E5E7EB] shadow-lg p-5"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-4 mb-4">
                                    <div>
                                        <h2
                                            className="text-[#0A2140]"
                                            style={{ fontSize: "18px", fontWeight: 700 }}
                                        >
                                            Upload document
                                        </h2>
                                        <p className="text-[#6B7280] text-sm mt-1">
                                            Choose a type, then select a JPG/JPEG file (max 100KB).
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={closeUploadModal}
                                        className="text-[#6B7280] hover:text-[#1D4ED8]"
                                        aria-label="Close upload popup"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <label
                                    htmlFor="upload-doc-type"
                                    className="block text-[#0A2140] text-sm font-semibold mb-2"
                                >
                                    Document type
                                </label>
                                <select
                                    id="upload-doc-type"
                                    value={uploadDocType}
                                    onChange={(e) =>
                                        setUploadDocType(
                                            e.target.value as
                                                | "Passport"
                                                | "Visa"
                                                | "Insurance"
                                                | "Booking",
                                        )
                                    }
                                    className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                                >
                                    <option value="Passport">Passport</option>
                                    <option value="Visa">Visa</option>
                                    <option value="Insurance">Insurance</option>
                                    <option value="Booking">Booking</option>
                                </select>

                                <div className="mt-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <button
                                            type="button"
                                            onClick={handleChooseFileClick}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
                                        >
                                            Choose file
                                        </button>
                                        <div className="text-sm text-[#6B7280] truncate max-w-[220px]">
                                            {selectedFileName ? (
                                                <span className="text-[#111827] font-medium">
                                                    {selectedFileName}
                                                </span>
                                            ) : (
                                                "No file chosen"
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
                                    <button
                                        type="button"
                                        onClick={closeUploadModal}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleUploadToDb}
                                        disabled={!selectedFileName || isUploadingToDb}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
                                    >
                                        Upload
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer border-none ${activeTab === tab
                                        ? "bg-[#1D4ED8] text-white"
                                        : "bg-white text-[#6B7280] hover:bg-[#F3F4F6] border border-[#E5E7EB]"
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Document Cards */}
                    {isLoadingVault ? (
                        <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
                            Loading documents…
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {visibleImages.length === 0 && (
                                <div className="col-span-full rounded-xl border border-[#E5E7EB] bg-white p-8 text-center">
                                    <p className="text-[#6B7280] text-sm sm:text-base">
                                        No documents uploaded yet. Click{" "}
                                        <span className="font-semibold">Upload</span>.
                                    </p>
                                </div>
                            )}
                            {visibleImages.map((img, idx) => (
                                <div
                                    key={img.id}
                                    className="bg-white rounded-xl border border-[#E5E7EB] hover:border-[#D1D5DB] p-4 sm:p-5 transition-all animate-slide-up"
                                    style={{ animationDelay: `${idx * 0.08}s` }}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">
                                                {img.docType === "Passport"
                                                    ? "🛂"
                                                    : img.docType === "Visa"
                                                      ? "📋"
                                                      : img.docType === "Insurance"
                                                        ? "🛡️"
                                                        : "✈️"}
                                            </span>
                                            <div>
                                                <h3
                                                    className="text-[#0A2140] mb-0.5"
                                                    style={{
                                                        fontSize: "14px",
                                                        fontWeight: "600",
                                                    }}
                                                >
                                                    {img.docType}
                                                </h3>
                                                <p className="text-[#6B7280] text-xs">
                                                    {img.fileName}
                                                </p>
                                            </div>
                                        </div>
                                        <span
                                            className={`${getDocTypeStyle(img.docType)} px-2 py-0.5 rounded-full text-[11px] font-medium`}
                                        >
                                            Uploaded
                                        </span>
                                    </div>

                                    <div className="mb-4">
                                        <div className="aspect-[4/3] bg-[#F3F4F6] rounded-lg border border-[#E5E7EB] flex items-center justify-center overflow-hidden">
                                            <img
                                                src={img.objectUrl}
                                                alt={`${img.docType} thumbnail`}
                                                className="w-full h-full object-cover"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end pt-3 border-t border-[#F3F4F6]">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="h-8 w-8 rounded-md inline-flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] border-none bg-transparent cursor-pointer"
                                                    aria-label={`Open menu for ${img.fileName ?? img.docType}`}
                                                >
                                                    <MoreVertical className="w-4 h-4" />
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-44">
                                                <DropdownMenuItem
                                                    onSelect={() => {
                                                        setPreview(img);
                                                        setIsPreviewModalOpen(true);
                                                    }}
                                                    className="flex items-center gap-2 cursor-pointer"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                    View
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onSelect={() => handleDownload(img)}
                                                    className="flex items-center gap-2 cursor-pointer"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Download
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onSelect={() => openEditModal(img)}
                                                    className="flex items-center gap-2 cursor-pointer"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                    Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onSelect={() => {
                                                        void handleDelete(img);
                                                    }}
                                                    className="flex items-center gap-2 cursor-pointer text-[#DC2626] focus:text-[#DC2626]"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {isPreviewModalOpen && preview && (
                        <div
                            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                            role="dialog"
                            aria-modal="true"
                            onClick={closePreview}
                        >
                            <div
                                className="w-full max-w-3xl bg-white rounded-2xl border border-[#E5E7EB] shadow-lg p-4"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div>
                                        <h2
                                            className="text-[#0A2140] text-base sm:text-lg font-semibold"
                                        >
                                            {preview.docType} Preview
                                        </h2>
                                        <p className="text-[#6B7280] text-sm mt-1">
                                            {preview.fileName}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={closePreview}
                                        className="text-[#6B7280] hover:text-[#1D4ED8]"
                                        aria-label="Close preview"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="bg-[#F3F4F6] rounded-xl border border-[#E5E7EB] overflow-hidden">
                                    <img
                                        src={preview.objectUrl}
                                        alt={`${preview.docType} preview`}
                                        className="w-full max-h-[70vh] object-contain"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {editingDoc && (
                        <div
                            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                            role="dialog"
                            aria-modal="true"
                            onClick={closeEditModal}
                        >
                            <div
                                className="w-full max-w-md bg-white rounded-2xl border border-[#E5E7EB] shadow-lg p-5"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-start justify-between gap-4 mb-4">
                                    <div>
                                        <h2 className="text-[#0A2140]" style={{ fontSize: "18px", fontWeight: 700 }}>
                                            Edit document
                                        </h2>
                                        <p className="text-[#6B7280] text-sm mt-1">
                                            Update document type and file name.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={closeEditModal}
                                        className="text-[#6B7280] hover:text-[#1D4ED8]"
                                        aria-label="Close edit popup"
                                    >
                                        ✕
                                    </button>
                                </div>
                                <label className="block text-[#0A2140] text-sm font-semibold mb-2">
                                    Document type
                                </label>
                                <select
                                    value={editDocType}
                                    onChange={(e) => setEditDocType(e.target.value as DocType)}
                                    className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                                >
                                    <option value="Passport">Passport</option>
                                    <option value="Visa">Visa</option>
                                    <option value="Insurance">Insurance</option>
                                    <option value="Booking">Booking</option>
                                </select>
                                <label className="block text-[#0A2140] text-sm font-semibold mt-4 mb-2">
                                    File name
                                </label>
                                <input
                                    value={editFileName}
                                    onChange={(e) => setEditFileName(e.target.value)}
                                    className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                                />
                                <div className="mt-5 flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={closeEditModal}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveEdit}
                                        disabled={isSavingEdit}
                                        className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
                                    >
                                        {isSavingEdit ? "Saving..." : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
