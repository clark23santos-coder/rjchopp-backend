import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class OrderController {
  async create(req: Request, res: Response) {
    try {
      const { clientId, paymentMethod, deliveryDate, note, items } = req.body;

      let total = 0;

      for (const item of items) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) {
          return res.status(404).json({
            message: 'Produto não encontrado'
          });
        }

        if (product.stock < item.quantity) {
          return res.status(400).json({
            message: `Estoque insuficiente para ${product.name}`
          });
        }

        total += product.salePrice * item.quantity;
      }

      const order = await prisma.order.create({
        data: {
          clientId,
          paymentMethod,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          note,
          total,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.unitPrice * item.quantity
            }))
          }
        },
        include: {
          client: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });

      for (const item of items) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId }
        });

        if (product) {
          await prisma.product.update({
            where: { id: item.productId },
            data: {
              stock: product.stock - item.quantity
            }
          });

          await prisma.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'OUTPUT',
              quantity: item.quantity,
              note: `Saída automática do pedido ${order.id}`
            }
          });
        }
      }

      await prisma.financialTransaction.create({
        data: {
          type: 'ENTRY',
          category: 'VENDA',
          description: `Venda do pedido ${order.id}`,
          amount: total
        }
      });

      return res.json(order);
    } catch (error) {
      console.log(error);

      return res.status(500).json({
        message: 'Erro ao criar pedido'
      });
    }
  }

  async list(req: Request, res: Response) {
    const orders = await prisma.order.findMany({
      include: {
        client: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(orders);
  }
}
