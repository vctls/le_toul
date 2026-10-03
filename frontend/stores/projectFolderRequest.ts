import { defineStore } from "pinia";
import { shallowRef } from "vue";

export interface ProjectFolderRequest {
  files: File[];
  name: string;
}

// The Files tab owns project folder loading and its overwrite prompt.
// Other tabs hand it a folder here instead.
export const useProjectFolderRequestStore = defineStore("projectFolderRequest", () => {
  const pending = shallowRef<ProjectFolderRequest | null>(null);

  function request(files: File[], name: string): void {
    pending.value = { files, name };
  }

  function take(): ProjectFolderRequest | null {
    const request = pending.value;
    pending.value = null;
    return request;
  }

  return { pending, request, take };
});
