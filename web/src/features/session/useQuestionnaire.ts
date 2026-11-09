import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import { PATIENT_KEY } from "@/features/patient/usePatientData";
import { api } from "@/lib/api";
import type { SessionFeedback, SessionFeedbackCreate } from "@/types/api";

function questionnaireKey(sessionId: number | null) {
  return [...PATIENT_KEY, "sessions", sessionId, "questionnaire"];
}

function isStatus(error: unknown, status: number): boolean {
  return axios.isAxiosError(error) && error.response?.status === status;
}

async function fetchQuestionnaire(sessionId: number): Promise<SessionFeedback | null> {
  try {
    return (await api.get<SessionFeedback>(`/sessions/${sessionId}/questionnaire`)).data;
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

/** The session's questionnaire with its flags, or null if it was not submitted. */
export function useQuestionnaire(sessionId: number | null) {
  return useQuery({
    queryKey: questionnaireKey(sessionId),
    queryFn: () => fetchQuestionnaire(sessionId ?? 0),
    enabled: sessionId !== null,
  });
}

/** Saves the answers. If they were already saved, such as on a retry, returns those. */
export function useSubmitQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      answers,
    }: {
      sessionId: number;
      answers: SessionFeedbackCreate;
    }): Promise<SessionFeedback> => {
      try {
        const url = `/sessions/${sessionId}/questionnaire`;
        return (await api.post<SessionFeedback>(url, answers)).data;
      } catch (error) {
        if (!isStatus(error, 409)) throw error;
        const saved = await fetchQuestionnaire(sessionId);
        if (saved === null) throw error;
        return saved;
      }
    },
    onSuccess: (saved) => queryClient.setQueryData(questionnaireKey(saved.session_id), saved),
  });
}
