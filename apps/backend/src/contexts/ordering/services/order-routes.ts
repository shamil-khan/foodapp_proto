import { Hono } from 'hono';
import type { AppEnv } from '@/container';

export const orderRoutes = new Hono<AppEnv>();

orderRoutes.get('/', (c) => c.var.di.get('orderController').listOrders(c));
orderRoutes.post('/', (c) => c.var.di.get('orderController').placeOrder(c));
orderRoutes.post('/:id/settle', (c) => c.var.di.get('orderController').settleOrder(c));
