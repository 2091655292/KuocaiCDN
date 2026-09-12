import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getToken, getUser } from '../api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(getToken());
  const user = ref(getUser());

  function setAuth(t: string, u: any) {
    token.value = t;
    user.value = u;
  }
  function logout() {
    token.value = '';
    user.value = null;
  }

  return { token, user, setAuth, logout };
});