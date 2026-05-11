"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Edit2, Save, X } from "lucide-react";
import { personalInfoSchema, type PersonalInfoValues } from "@/lib/validations";

export interface PersonalDataShape {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  address: string;
  phone: string;
}

interface PersonalInformationProps {
  initialData?: Partial<PersonalDataShape> | null;
  userId?: string;
}

export function PersonalInformation({ initialData, userId }: PersonalInformationProps) {
  const [isEditing, setIsEditing] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<PersonalInfoValues>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      date_of_birth: "",
      gender: "",
      nationality: "",
      address: "",
    },
  });

  // Sync form when initial data loads
  useEffect(() => {
    if (initialData) {
      reset({
        first_name: initialData.firstName ?? "",
        last_name: initialData.lastName ?? "",
        email: initialData.email ?? "",
        phone: initialData.phone ?? "",
        date_of_birth: initialData.dateOfBirth ?? "",
        gender: (initialData.gender as PersonalInfoValues["gender"]) ?? "",
        nationality: initialData.nationality ?? "",
        address: initialData.address ?? "",
      });
    }
  }, [initialData, reset]);

  const onSave = async (values: PersonalInfoValues) => {
    if (!userId) {
      toast.error("Cannot save — user ID is missing.");
      return;
    }

    const toastId = toast.loading("Saving changes…");
    try {
      const res = await fetch(`/api/user/profile?user_id=${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: values.first_name,
          last_name: values.last_name || null,
          phone: values.phone || null,
          date_of_birth: values.date_of_birth || null,
          gender: values.gender || null,
          nationality: values.nationality || null,
          address: values.address || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Save failed");

      toast.success("Personal details saved!", { id: toastId });
      setIsEditing(false);
      window.dispatchEvent(new Event("profile-updated"));
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save changes.",
        { id: toastId }
      );
    }
  };

  const handleCancel = () => {
    reset(); // revert to last saved values
    setIsEditing(false);
  };

  const fieldClass = (hasError: boolean) =>
    `flex h-10 w-full rounded-lg border px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent transition-colors ${
      hasError ? "border-rose-400 bg-rose-50" : "border-[#E5E7EB] bg-white"
    }`;

  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
    backgroundPosition: "right 0.75rem center",
    backgroundRepeat: "no-repeat" as const,
    backgroundSize: "1em 1em",
    paddingRight: "2.5rem",
  };

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6 mb-6">
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E5E7EB]">
        <h2 className="text-[#0A2140] text-base font-semibold">
          Personal Details
        </h2>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center text-[#0B5FFF] hover:text-[#0047CC] hover:bg-[#F0F4FF] gap-1.5 sm:gap-2 h-8 sm:h-9 text-sm px-3 rounded-md transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        ) : (
          <div className="flex gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex items-center text-[#6B7280] hover:text-[#374151] hover:bg-[#F9FAFB] h-8 sm:h-9 text-sm px-2 sm:px-3 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1" />
              <span className="hidden sm:inline">Cancel</span>
            </button>
            <button
              type="button"
              onClick={handleSubmit(onSave)}
              disabled={isSubmitting || !isDirty}
              className={`flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 text-sm px-2 sm:px-3 rounded-md transition-colors text-white ${
                isSubmitting || !isDirty
                  ? "bg-[#93C5FD] cursor-default"
                  : "bg-[#0B5FFF] hover:bg-[#0047CC] cursor-pointer"
              }`}
            >
              <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">
                {isSubmitting ? "Saving…" : "Save"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <form
        onSubmit={handleSubmit(onSave)}
        noValidate
        className="px-4 sm:px-6 py-4 sm:py-5"
      >
        <div className="space-y-4 sm:space-y-5">
          {/* First Name */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                First Name
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("first_name")}
                    className={fieldClass(!!errors.first_name)}
                    placeholder="Your first name"
                  />
                  {errors.first_name && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.first_name.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.firstName} />
              )}
            </div>
          </div>

          <Divider />

          {/* Last Name */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Last Name
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("last_name")}
                    className={fieldClass(!!errors.last_name)}
                    placeholder="Your last name"
                  />
                  {errors.last_name && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.last_name.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.lastName} />
              )}
            </div>
          </div>

          <Divider />

          {/* Date of Birth */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Date of Birth
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("date_of_birth")}
                    type="date"
                    className={fieldClass(!!errors.date_of_birth)}
                  />
                  {errors.date_of_birth && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.date_of_birth.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue
                  value={
                    initialData?.dateOfBirth
                      ? new Date(initialData.dateOfBirth).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })
                      : undefined
                  }
                />
              )}
            </div>
          </div>

          <Divider />

          {/* Gender */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Gender
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <select
                    {...register("gender")}
                    className={`${fieldClass(!!errors.gender)} appearance-none cursor-pointer`}
                    style={selectStyle}
                  >
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    {/* <option value="Prefer not to say">Prefer not to say</option> */}
                  </select>
                  {errors.gender && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.gender.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.gender} />
              )}
            </div>
          </div>

          <Divider />

          {/* Nationality */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Nationality
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("nationality")}
                    className={fieldClass(!!errors.nationality)}
                    placeholder="e.g. American"
                  />
                  {errors.nationality && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.nationality.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.nationality} />
              )}
            </div>
          </div>

          <Divider />

          {/* Address */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Address
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("address")}
                    className={fieldClass(!!errors.address)}
                    placeholder="Your address"
                  />
                  {errors.address && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.address.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.address} />
              )}
            </div>
          </div>

          <Divider />

          {/* Phone */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Phone Number
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("phone")}
                    type="tel"
                    className={fieldClass(!!errors.phone)}
                    placeholder="+1 555 000 1234"
                  />
                  {errors.phone && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.phone.message}</p>
                  )}
                </>
              ) : (
                <DisplayValue value={initialData?.phone} />
              )}
            </div>
          </div>

          <Divider />

          {/* Email */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="sm:w-40 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Email
              </p>
            </div>
            <div className="flex-1">
              {isEditing ? (
                <>
                  <input
                    {...register("email")}
                    type="email"
                    className={fieldClass(!!errors.email)}
                    placeholder="you@example.com"
                    readOnly
                  />
                  {errors.email && (
                    <p className="mt-1 text-[11px] text-rose-500">{errors.email.message}</p>
                  )}
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">
                    Email comes from your sign-in account and is filled automatically.
                  </p>
                </>
              ) : (
                <DisplayValue value={initialData?.email} />
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#F3F4F6]" />;
}

function DisplayValue({ value }: { value?: string | null }) {
  return (
    <p
      className={`text-[13px] font-medium ${value ? "text-[#0A2140]" : "text-[#9CA3AF]"} break-all`}
    >
      {value || "—"}
    </p>
  );
}
