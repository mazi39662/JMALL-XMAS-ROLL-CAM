import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import RegisterView from '@/views/RegisterView.vue'
import CameraView from '@/views/CameraView.vue'
import GuestGalleryView from '@/views/GuestGalleryView.vue'
import AdminLoginView from '@/views/AdminLoginView.vue'
import AdminDashboardView from '@/views/AdminDashboardView.vue'
import { getActiveClientSession } from '@/services/repository'
import { getCurrentAdminSession } from '@/services/adminAuth'

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: LandingView
  },
  {
    path: '/register',
    name: 'register',
    component: RegisterView
  },
  {
    path: '/camera',
    name: 'camera',
    component: CameraView,
    meta: { requiresGuestSession: true }
  },
  {
    path: '/my-photos',
    name: 'guest-gallery',
    component: GuestGalleryView,
    meta: { requiresGuestSession: true }
  },
  {
    path: '/admin',
    name: 'admin-login',
    component: AdminLoginView
  },
  {
    path: '/admin/dashboard',
    name: 'admin-dashboard',
    component: AdminDashboardView,
    meta: { requiresAdmin: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.beforeEach(async (to) => {
  if (to.meta.requiresGuestSession) {
    const clientSession = getActiveClientSession()
    if (!clientSession) {
      return { name: 'register' }
    }
  }

  if (to.meta.requiresAdmin) {
    const adminSession = await getCurrentAdminSession()
    if (!adminSession || !adminSession.isAdminVerified) {
      return { name: 'admin-login' }
    }
  }

  return true
})

export default router

