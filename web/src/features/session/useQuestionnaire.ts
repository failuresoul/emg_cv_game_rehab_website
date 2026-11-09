import { useMutation } from "@tanstack/react-query";
import axios from "axios";

import { api } from "@/lib/api";
import type { SessionFeedback, SessionFeedbackCreate } from "@/types/api";

function isStatus(error: unknown, status: number): boolean {
  return axios.isAxiosError(error) && error.response?.status === status;
}

/**
 * Saves the answers. If they were already saved, such as on a retry, returns those. The
 * summary reads them, with their flags, from GET /sessions/{id}/summary.
 */
export function useSubmitQuestionnaire() {
  return useMutation({
    mutationFn: async ({
      sessionId,
      answers,
    }: {
      sessionId: number;
      answers: SessionFeedbackCreate;
    }): Promise<SessionFeedback> => {
      const url = `/sessions/${sessionId}/questionnaire`;
      try {
        return (await api.post<SessionFeedback>(url, answers)).data;
      } catch (error) {
        if (!isStatus(error, 409)) throw error;
        return (await api.get<SessionFeedback>(url)).data;
      }
    },
  });
}
