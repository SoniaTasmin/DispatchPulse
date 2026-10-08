import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

// The one piece of hand-written global state: any page can raise a toast, and the app
// shell renders them. Everything else is server data (RTK Query) or local component state.
export interface Toast {
  id: string;
  kind: 'success' | 'error';
  message: string;
}

const initialState: Toast[] = [];

const toastsSlice = createSlice({
  name: 'toasts',
  initialState,
  reducers: {
    toastShown: {
      reducer: (toasts, action: PayloadAction<Toast>) => {
        toasts.push(action.payload);
      },
      prepare: (kind: Toast['kind'], message: string) => ({
        payload: { id: nanoid(), kind, message },
      }),
    },
    toastDismissed: (toasts, action: PayloadAction<string>) =>
      toasts.filter((toast) => toast.id !== action.payload),
  },
});

export const { toastShown, toastDismissed } = toastsSlice.actions;
export const toastsReducer = toastsSlice.reducer;
