"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ImageUp,
  Trash2,
} from "lucide-react";
import { PersonalInformation } from "../../../components/PersonalInformation";
import { TravelPreferences } from "../../../components/TravelPreferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProfilePersonalData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  address: string;
}

interface DbProfileResponse {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  address: string | null;
  avatar_url: string | null;
}

const AVATAR_MAX_DIMENSION = 512;
const AVATAR_OUTPUT_QUALITY = 0.82;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read the selected image."));
    };
    reader.onerror = () => reject(new Error("Failed to read the selected image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load the selected image."));
    image.src = src;
  });
}

async function buildAvatarDataUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    AVATAR_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare the selected image.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", AVATAR_OUTPUT_QUALITY);
}

export default function ProfilePage() {
  const { isLoaded, isSignedIn } = useUser();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [dbUserId, setDbUserId] = useState<string | null>(null);
  const [personalData, setPersonalData] = useState<ProfilePersonalData | null>(null);
  const [headerProfile, setHeaderProfile] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    avatar_url: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isAvatarSaving, setIsAvatarSaving] = useState(false);
  const displayHeaderProfile = headerProfile;
  const displayFullName = `${displayHeaderProfile.first_name} ${displayHeaderProfile.last_name}`.trim();
  const displayAvatarUrl = displayHeaderProfile.avatar_url.trim();
  const displayPersonalData: ProfilePersonalData = personalData ?? {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    nationality: "",
    address: "",
  };

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    if (!isSignedIn) {
      setIsProfileLoading(false);
      return;
    }

    const fetchProfile = async () => {
      setIsProfileLoading(true);
      try {
        const res = await fetch("/api/user/profile", {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            return;
          }
          if (res.status === 404) {
            toast.info("Complete your profile to get started.");
          } else {
            toast.error("Failed to load profile. Please refresh.");
          }
          return;
        }

        const data = (await res.json()) as DbProfileResponse;
        setDbUserId(data.id);
        setHeaderProfile({
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          avatar_url: data.avatar_url ?? "",
        });
        setPersonalData({
          firstName: data.first_name ?? "",
          lastName: data.last_name ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          dateOfBirth: data.date_of_birth ?? "",
          gender: data.gender ?? "",
          nationality: data.nationality ?? "",
          address: data.address ?? "",
        });
      } catch {
        toast.error("Failed to load profile. Please refresh.");
      } finally {
        setIsProfileLoading(false);
      }
    };

    void fetchProfile();
  }, [isLoaded, isSignedIn, refreshKey]);

  useEffect(() => {
    const handleProfileUpdated = () => {
      setRefreshKey((value) => value + 1);
    };

    window.addEventListener("profile-updated", handleProfileUpdated);
    return () => window.removeEventListener("profile-updated", handleProfileUpdated);
  }, []);

  const saveAvatar = async (avatarUrl: string | null, successMessage: string) => {
    const toastId = toast.loading(avatarUrl ? "Uploading picture..." : "Removing picture...");

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar_url: avatarUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? "Failed to update profile picture.");
      }

      setHeaderProfile((current) => ({
        ...current,
        avatar_url: avatarUrl ?? "",
      }));
      toast.success(successMessage, { id: toastId });
      window.dispatchEvent(new Event("profile-updated"));
      return true;
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile picture.",
        { id: toastId },
      );
      return false;
    }
  };

  const handleUploadAvatarMenuClick = () => {
    avatarInputRef.current?.click();
  };

  const handleDeleteAvatar = async () => {
    if (!displayAvatarUrl || isAvatarSaving) {
      return;
    }

    setIsAvatarSaving(true);
    try {
      await saveAvatar(null, "Profile picture deleted.");
    } finally {
      setIsAvatarSaving(false);
    }
  };

  const handleAvatarSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }

    if (isAvatarSaving) {
      return;
    }

    setIsAvatarSaving(true);
    try {
      const avatarDataUrl = await buildAvatarDataUrl(file);
      await saveAvatar(avatarDataUrl, "Profile picture updated.");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to process the selected image.",
      );
    } finally {
      setIsAvatarSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8">
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarSelected}
        />

        {/* Back Button */}
        <button
          onClick={() => window.history.back()}
          className="flex items-center mb-4 sm:mb-6 -ml-2 sm:-ml-3 text-[#6B7280] hover:text-[#374151] hover:bg-[#F9FAFB] h-9 sm:h-10 px-2 sm:px-3 rounded-md text-sm transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
          Back
        </button>

        {isProfileLoading ? (
          <div className="space-y-6">
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 animate-pulse">
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-200 flex-shrink-0" />
                <div className="flex-1 space-y-3 pt-1">
                  <div className="h-6 w-56 rounded bg-slate-200" />
                  <div className="h-4 w-64 rounded bg-slate-100" />
                  <div className="h-4 w-40 rounded bg-slate-100" />
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 animate-pulse">
              <div className="h-5 w-40 rounded bg-slate-200 mb-4" />
              <div className="space-y-4">
                <div className="h-10 rounded bg-slate-100" />
                <div className="h-10 rounded bg-slate-100" />
                <div className="h-10 rounded bg-slate-100" />
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Profile Header */}
        <div className="mb-6 sm:mb-10">
          <div className="flex items-start gap-4 sm:gap-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isAvatarSaving}
                  className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-[#E5E7EB] flex-shrink-0 bg-[#EEF2FF] flex items-center justify-center text-[#3730A3] text-xl font-semibold overflow-hidden cursor-pointer disabled:cursor-default disabled:opacity-70"
                  aria-label="Change profile picture"
                >
                  {displayAvatarUrl ? (
                    <img
                      src={displayAvatarUrl}
                      alt={`${displayFullName || "User"} profile`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>
                      {(displayFullName || displayHeaderProfile.email || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}
                  <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border border-white bg-[#0B5FFF] text-white shadow-sm">
                    <Camera className="w-3 h-3" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-48 bg-white border-[#E5E7EB] shadow-lg rounded-md p-1 z-50"
              >
                <DropdownMenuItem
                  className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                  onSelect={(event) => {
                    event.preventDefault();
                    handleUploadAvatarMenuClick();
                  }}
                >
                  <ImageUp className="w-4 h-4" />
                  Upload new picture
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!displayAvatarUrl || isAvatarSaving}
                  className="flex items-center gap-2 cursor-pointer text-[#DC2626] hover:bg-[#FEE2E2] hover:text-[#DC2626] px-2 py-1.5 rounded-sm outline-none disabled:text-[#9CA3AF] disabled:hover:bg-transparent"
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleDeleteAvatar();
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete picture
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex-1 pt-0.5 sm:pt-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-[#0A2140] text-[22px] font-bold truncate">
                  {displayFullName || "Complete your profile"}
                </h1>
                {displayFullName && (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-[#0B5FFF] flex-shrink-0" />
                )}
              </div>
              <p className="text-[#6B7280] text-sm truncate">
                {displayHeaderProfile.email || "Add your email in Personal Details"}
              </p>
              <p className="text-[#9CA3AF] text-[13px] truncate mt-1">
                {displayHeaderProfile.phone || "Add your phone number in Personal Details"}
              </p>
              <p className="text-[#9CA3AF] text-[12px] mt-2">
                Click the picture to upload a new photo or remove the current one.
              </p>
            </div>
          </div>
        </div>

        <PersonalInformation
          initialData={displayPersonalData}
          userId={dbUserId ?? undefined}
        />
        <TravelPreferences userId={dbUserId ?? undefined} />
          </>
        )}
      </div>
    </div>
  );
}
