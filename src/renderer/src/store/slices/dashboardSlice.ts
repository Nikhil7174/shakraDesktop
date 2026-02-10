import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { InterviewAttempt } from '../../types';
import api from '../../services/api';

interface DashboardState {
    attempts: InterviewAttempt[];
    isLoading: boolean;
    error: string | null;
    lastFetch: number | null;
    cacheExpiry: number; // 30 minutes in milliseconds
}

const initialState: DashboardState = {
    attempts: [],
    isLoading: false,
    error: null,
    lastFetch: null,
    cacheExpiry: 30 * 60 * 1000, // 30 minutes
};

// Async thunk to fetch dashboard data
export const fetchDashboardData = createAsyncThunk(
    'dashboard/fetchData',
    async (force: boolean = false, { getState, rejectWithValue }) => {
        const state = getState() as any;
        const { lastFetch, cacheExpiry, attempts } = state.dashboard;

        // Check if cache is valid and we have data
        const isCacheValid = lastFetch && Date.now() - lastFetch < cacheExpiry;

        if (!force && isCacheValid && attempts.length > 0) {
            console.log('📦 [Dashboard] Using cached dashboard data');
            return { attempts, cached: true };
        }

        try {
            console.log('⬇️ [Dashboard] Fetching new data from API...');
            const response = await api.get('/auth/interviews');

            if (response.data.success) {
                return { attempts: response.data.interviews || [], cached: false };
            } else {
                return rejectWithValue(response.data.error || 'Failed to fetch interviews');
            }
        } catch (error: any) {
            console.error('Failed to fetch dashboard data:', error);
            return rejectWithValue(error.response?.data?.message || error.message || 'Failed to fetch interviews');
        }
    }
);

const dashboardSlice = createSlice({
    name: 'dashboard',
    initialState,
    reducers: {
        clearDashboardCache: (state) => {
            state.lastFetch = null;
            state.attempts = [];
            state.error = null;
        },
        invalidateDashboardCache: (state) => {
            state.lastFetch = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchDashboardData.pending, (state) => {
                state.isLoading = true;
                state.error = null;
            })
            .addCase(fetchDashboardData.fulfilled, (state, action) => {
                state.isLoading = false;
                // Only update if we actually performed a fetch (not cached)
                if (!action.payload.cached) {
                    state.attempts = action.payload.attempts;
                    state.lastFetch = Date.now();
                }
            })
            .addCase(fetchDashboardData.rejected, (state, action) => {
                state.isLoading = false;
                state.error = action.payload as string;
            });
    },
});

export const { clearDashboardCache, invalidateDashboardCache } = dashboardSlice.actions;
export default dashboardSlice.reducer;
