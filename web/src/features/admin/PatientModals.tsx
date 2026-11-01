import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { t } from "@/i18n";
import type { Patient } from "@/types/api";

import { useCreatePatient, useUpdatePatient } from "./hooks";
import { PatientForm } from "./PatientForm";

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

// The forms mount only while open, so reopening starts with fresh values and no old errors.

function AddPatientForm({ onClose }: Pick<ModalProps, "onClose">) {
  const createPatient = useCreatePatient();
  const showToast = useToast();

  return (
    <PatientForm
      isPending={createPatient.isPending}
      serverError={createPatient.error}
      onCancel={onClose}
      onSubmit={(payload) =>
        createPatient.mutate(payload, {
          onSuccess: (patient) => {
            showToast("success", t("patients.created", { code: patient.patient_code }));
            onClose();
          },
        })
      }
    />
  );
}

export function AddPatientModal({ open, onClose }: ModalProps) {
  return (
    <Modal open={open} title={t("admin.addPatient")} onClose={onClose}>
      {open && <AddPatientForm onClose={onClose} />}
    </Modal>
  );
}

function EditPatientForm({ patient, onClose }: Pick<ModalProps, "onClose"> & { patient: Patient }) {
  const updatePatient = useUpdatePatient(patient.id);
  const showToast = useToast();

  return (
    <PatientForm
      patient={patient}
      isPending={updatePatient.isPending}
      serverError={updatePatient.error}
      onCancel={onClose}
      onSubmit={({ password, ...changes }) =>
        updatePatient.mutate(password ? { ...changes, password } : changes, {
          onSuccess: () => {
            showToast("success", t("patient.updated"));
            onClose();
          },
        })
      }
    />
  );
}

export function EditPatientModal({ patient, open, onClose }: ModalProps & { patient: Patient }) {
  return (
    <Modal open={open} title={t("patient.editTitle")} onClose={onClose}>
      {open && <EditPatientForm patient={patient} onClose={onClose} />}
    </Modal>
  );
}
