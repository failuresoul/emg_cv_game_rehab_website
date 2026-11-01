import axios from "axios";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";
import type { AgeBand, Language, Patient, PatientCreate, Side } from "@/types/api";

const AGE_BANDS: AgeBand[] = ["18-29", "30-39", "40-49", "50-59", "60-69", "70+"];
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const GENERATED_PASSWORD_LENGTH = 14;
// Leaves out look-alike characters (I, l, 1, O, 0) because the password is passed on by hand.
const PASSWORD_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

interface FormValues {
  full_name: string;
  email: string;
  password: string;
  affected_side: string;
  dominant_side: string;
  age_band: string;
  months_since_stroke: string;
  language: string;
  notes: string;
}

type Field = keyof FormValues;
type FieldErrors = Partial<Record<Field, string>>;

function initialValues(patient?: Patient): FormValues {
  return {
    full_name: patient?.user.full_name ?? "",
    email: patient?.user.email ?? "",
    password: "",
    affected_side: patient?.affected_side ?? "",
    dominant_side: patient?.dominant_side ?? "",
    age_band: patient?.age_band ?? "",
    months_since_stroke: patient?.months_since_stroke?.toString() ?? "",
    language: patient?.language ?? "en",
    notes: patient?.notes ?? "",
  };
}

function validate(values: FormValues, passwordRequired: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.full_name.trim()) errors.full_name = t("patientForm.error.fullName");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = t("patientForm.error.email");
  }
  const passwordLength = values.password.length;
  if (
    (passwordRequired || passwordLength > 0) &&
    (passwordLength < PASSWORD_MIN || passwordLength > PASSWORD_MAX)
  ) {
    errors.password = t("patientForm.error.passwordLength");
  }
  if (!values.affected_side) errors.affected_side = t("patientForm.error.required");
  if (!values.dominant_side) errors.dominant_side = t("patientForm.error.required");
  if (!values.age_band) errors.age_band = t("patientForm.error.required");
  if (values.months_since_stroke && !/^\d+$/.test(values.months_since_stroke.trim())) {
    errors.months_since_stroke = t("patientForm.error.months");
  }
  return errors;
}

/** Only call after validate() finds no errors. An empty password means "unchanged" when editing. */
function toPayload(values: FormValues): PatientCreate {
  const months = values.months_since_stroke.trim();
  return {
    full_name: values.full_name.trim(),
    email: values.email.trim(),
    password: values.password,
    affected_side: values.affected_side as Side,
    dominant_side: values.dominant_side as Side,
    age_band: values.age_band as AgeBand,
    months_since_stroke: months ? Number(months) : null,
    language: values.language as Language,
    notes: values.notes.trim() || null,
  };
}

function parseServerError(error: unknown): { fields: FieldErrors; form?: string } {
  if (!error) return { fields: {} };

  if (axios.isAxiosError<{ detail?: unknown }>(error)) {
    if (error.response?.status === 409) {
      return { fields: { email: t("patientForm.error.duplicateEmail") } };
    }
    const detail = error.response?.data?.detail;
    if (error.response?.status === 422 && Array.isArray(detail)) {
      const fields: FieldErrors = {};
      for (const item of detail as { loc?: (string | number)[] }[]) {
        const field = item.loc?.[1];
        if (typeof field === "string" && field in initialValues()) {
          fields[field as Field] = t("patientForm.error.invalidValue");
        }
      }
      if (Object.keys(fields).length > 0) return { fields };
    }
  }
  return { fields: {}, form: t("patientForm.error.generic") };
}

function generatePassword(): string {
  const randomValues = crypto.getRandomValues(new Uint32Array(GENERATED_PASSWORD_LENGTH));
  return Array.from(
    randomValues,
    (value) => PASSWORD_CHARACTERS[value % PASSWORD_CHARACTERS.length],
  ).join("");
}

interface PatientFormProps {
  /** The patient being edited; leave out to create a new patient. */
  patient?: Patient;
  isPending: boolean;
  serverError: unknown;
  onSubmit: (payload: PatientCreate) => void;
  onCancel: () => void;
}

export function PatientForm({
  patient,
  isPending,
  serverError,
  onSubmit,
  onCancel,
}: PatientFormProps) {
  const isEditing = patient !== undefined;
  const [values, setValues] = useState(() => initialValues(patient));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);

  const server = parseServerError(serverError);

  function setField(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate(values, !isEditing);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSubmit(toPayload(values));
  }

  const errorFor = (field: Field) => errors[field] ?? server.fields[field];
  const sideOptions = [
    { value: "", label: t("common.select") },
    { value: "left", label: t("side.left") },
    { value: "right", label: t("side.right") },
  ];

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label={t("patientForm.fullName")}
        autoComplete="off"
        value={values.full_name}
        error={errorFor("full_name")}
        onChange={(event) => setField("full_name", event.target.value)}
      />
      <Input
        label={t("patientForm.email")}
        type="email"
        autoComplete="off"
        value={values.email}
        error={errorFor("email")}
        onChange={(event) => setField("email", event.target.value)}
      />
      <div className="flex flex-col gap-2">
        <Input
          label={t("patientForm.password")}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          hint={t(isEditing ? "patientForm.passwordEditHint" : "patientForm.passwordHint")}
          value={values.password}
          error={errorFor("password")}
          onChange={(event) => setField("password", event.target.value)}
          trailing={
            <button
              type="button"
              aria-label={t(showPassword ? "login.hidePassword" : "login.showPassword")}
              onClick={() => setShowPassword((shown) => !shown)}
              className="text-muted hover:text-ink inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
            >
              {showPassword ? <EyeOff size={22} aria-hidden /> : <Eye size={22} aria-hidden />}
            </button>
          }
        />
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setField("password", generatePassword());
              setShowPassword(true);
            }}
          >
            <KeyRound size={20} aria-hidden />
            {t("patientForm.generatePassword")}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t("patientForm.affectedSide")}
          options={sideOptions}
          value={values.affected_side}
          error={errorFor("affected_side")}
          onChange={(event) => setField("affected_side", event.target.value)}
        />
        <Select
          label={t("patientForm.dominantSide")}
          options={sideOptions}
          value={values.dominant_side}
          error={errorFor("dominant_side")}
          onChange={(event) => setField("dominant_side", event.target.value)}
        />
        <Select
          label={t("patientForm.ageBand")}
          options={[
            { value: "", label: t("common.select") },
            ...AGE_BANDS.map((band) => ({ value: band, label: band })),
          ]}
          value={values.age_band}
          error={errorFor("age_band")}
          onChange={(event) => setField("age_band", event.target.value)}
        />
        <Select
          label={t("patientForm.language")}
          options={[
            { value: "en", label: t("language.en") },
            { value: "bn", label: t("language.bn") },
          ]}
          value={values.language}
          error={errorFor("language")}
          onChange={(event) => setField("language", event.target.value)}
        />
      </div>
      <Input
        label={t("patientForm.monthsSinceStroke")}
        type="number"
        min={0}
        step={1}
        value={values.months_since_stroke}
        error={errorFor("months_since_stroke")}
        onChange={(event) => setField("months_since_stroke", event.target.value)}
      />
      <Textarea
        label={t("patientForm.notes")}
        value={values.notes}
        error={errorFor("notes")}
        onChange={(event) => setField("notes", event.target.value)}
      />
      {server.form && (
        <p role="alert" className="text-danger font-medium">
          {server.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={isPending}>
          {t(isEditing ? "common.save" : "admin.addPatient")}
        </Button>
      </div>
    </form>
  );
}
