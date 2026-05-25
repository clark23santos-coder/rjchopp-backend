import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const db: any = prisma;

const app = express();

const allowedOrigins = String(process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'RJ_CHOPP_SECRET';

function toNumber(value: any) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return 0;
  }

  return number;
}

function normalizeOrderStatus(status: any) {
  const text = String(status || '').toLowerCase();

  if (text.includes('cancel')) {
    return 'CANCELED';
  }

  if (text.includes('final')) {
    return 'FINISHED';
  }

  if (
    text.includes('entreg') ||
    text.includes('aprov') ||
    text.includes('andamento')
  ) {
    return 'APPROVED';
  }

  return 'PENDING';
}

function shouldDiscountStock(value: any) {
  if (value === false) {
    return false;
  }

  const text = String(value ?? 'true')
    .toLowerCase()
    .trim();

  if (
    text === 'false' ||
    text === '0' ||
    text === 'nao' ||
    text === 'não' ||
    text === 'n' ||
    text === 'no' ||
    text === 'agendado' ||
    text === 'agenda' ||
    text === 'scheduled' ||
    text === 'schedule' ||
    text.includes('agendado') ||
    text.includes('não') ||
    text.includes('nao') ||
    text.includes('deixar pedido agendado')
  ) {
    return false;
  }

  return true;
}

function noteHasStockDiscounted(note: any) {
  return String(note || '').includes('[ESTOQUE_BAIXADO]');
}

function cleanInternalStockFlags(note: any) {
  return String(note || '')
    .replace(/\n?\[ESTOQUE_BAIXADO\]/g, '')
    .replace(/\n?\[ESTOQUE_AGENDADO\]/g, '')
    .trim();
}

function addStockFlagToNote(note: any, stockDiscounted: boolean) {
  const cleanNote = cleanInternalStockFlags(note);
  const flag = stockDiscounted ? '[ESTOQUE_BAIXADO]' : '[ESTOQUE_AGENDADO]';

  return cleanNote ? `${cleanNote}\n${flag}` : flag;
}

async function discountOrderStock(tx: any, orderId: string, items: any[]) {
  for (const item of items) {
    const product = await tx.product.findUnique({
      where: {
        id: item.productId,
      },
    });

    if (product) {
      await tx.product.update({
        where: {
          id: item.productId,
        },
        data: {
          stock: toNumber(product.stock) - toNumber(item.quantity),
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'OUTPUT',
          quantity: item.quantity,
          note: `Saída automática do pedido ${orderId}`,
        },
      });
    }
  }
}

async function restoreOrderStock(tx: any, orderId: string, items: any[]) {
  for (const item of items) {
    const product = await tx.product.findUnique({
      where: {
        id: item.productId,
      },
    });

    if (product) {
      await tx.product.update({
        where: {
          id: item.productId,
        },
        data: {
          stock: toNumber(product.stock) + toNumber(item.quantity),
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'ENTRY',
          quantity: item.quantity,
          note: `Ajuste automático do pedido editado ${orderId}`,
        },
      });
    }
  }
}

async function prepareOrderItems(items: any[]) {
  return Promise.all(
    items.map(async (item: any) => {
      const product = await db.product.findUnique({
        where: {
          id: String(item.productId || ''),
        },
      });

      const quantity = toNumber(item.quantity || 1);

      const unitPrice =
        item.unitPrice !== undefined
          ? toNumber(item.unitPrice)
          : item.price !== undefined
          ? toNumber(item.price)
          : toNumber(product?.salePrice);

      return {
        productId: String(item.productId || ''),
        quantity,
        unitPrice,
        total:
          item.total !== undefined
            ? toNumber(item.total)
            : quantity * unitPrice,
      };
    })
  );
}

function authMiddleware(req: any, res: any, next: any) {
  req.user = {
    id: 'local-admin',
    role: 'ADMIN',
  };

  next();
}

app.get('/', (req, res) => {
  return res.json({
    message: 'API RJ Chopp rodando',
    status: 'online',
  });
});

app.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'RJ Chopp API',
    time: new Date().toISOString(),
  });
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await db.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Usuário inválido' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Senha inválida' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: '7d',
      }
    );

    return res.json({
      token,
      user,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// DASHBOARD
app.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const products = await db.product.findMany();
    const clients = await db.client.findMany();
    const orders = await db.order.findMany();
    const transactions = await db.financialTransaction.findMany();

    const lowStock = products.filter((product: any) => {
      return toNumber(product.stock) <= toNumber(product.minimumStock);
    });

    const revenue = transactions
      .filter((transaction: any) => transaction.type === 'ENTRY')
      .reduce((sum: number, transaction: any) => {
        return sum + toNumber(transaction.amount);
      }, 0);

    const expenses = transactions
      .filter((transaction: any) => transaction.type === 'OUTPUT')
      .reduce((sum: number, transaction: any) => {
        return sum + toNumber(transaction.amount);
      }, 0);

    return res.json({
      products: products.length,
      clients: clients.length,
      orders: orders.length,
      lowStock: lowStock.length,
      revenue,
      expenses,
      balance: revenue - expenses,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao carregar dashboard' });
  }
});

// PRODUTOS
app.get('/products', authMiddleware, async (req, res) => {
  try {
    const products = await db.product.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return res.json(products);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

app.post('/products', authMiddleware, async (req, res) => {
  try {
    const product = await db.product.create({
      data: {
        name: String(req.body.name || ''),
        category: String(req.body.category || ''),
        brand: String(req.body.brand || ''),
        unit: String(req.body.unit || ''),
        stock: toNumber(req.body.stock),
        minimumStock: toNumber(req.body.minimumStock),
        costPrice: toNumber(req.body.costPrice),
        salePrice: toNumber(req.body.salePrice),
      },
    });

    return res.json(product);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao criar produto' });
  }
});

app.put('/products/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await db.product.update({
      where: { id },
      data: {
        name: String(req.body.name || ''),
        category: String(req.body.category || ''),
        brand: String(req.body.brand || ''),
        unit: String(req.body.unit || ''),
        stock: toNumber(req.body.stock),
        minimumStock: toNumber(req.body.minimumStock),
        costPrice: toNumber(req.body.costPrice),
        salePrice: toNumber(req.body.salePrice),
      },
    });

    return res.json(product);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao editar produto' });
  }
});

app.delete('/products/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await db.product.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        error: 'Produto não encontrado.',
      });
    }

    await db.$transaction(async (tx: any) => {
      const orderItemsUsingProduct = await tx.orderItem.findMany({
        where: {
          productId: id,
        },
        select: {
          id: true,
          orderId: true,
          total: true,
        },
      });

      const affectedOrderIds = Array.from(
        new Set(
          orderItemsUsingProduct
            .map((item: any) => item.orderId)
            .filter(Boolean)
        )
      );

      await tx.stockMovement.deleteMany({
        where: {
          productId: id,
        },
      });

      await tx.orderItem.deleteMany({
        where: {
          productId: id,
        },
      });

      for (const orderId of affectedOrderIds) {
        const remainingItems = await tx.orderItem.findMany({
          where: {
            orderId,
          },
        });

        const newTotal = remainingItems.reduce((sum: number, item: any) => {
          return sum + toNumber(item.total);
        }, 0);

        const orderStillExists = await tx.order.findUnique({
          where: {
            id: orderId,
          },
        });

        if (orderStillExists) {
          await tx.order.update({
            where: {
              id: orderId,
            },
            data: {
              total: newTotal,
              note: orderStillExists.note
                ? `${orderStillExists.note}\nProduto removido do pedido porque foi apagado do cadastro.`
                : 'Produto removido do pedido porque foi apagado do cadastro.',
            },
          });
        }
      }

      await tx.product.delete({
        where: { id },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      error:
        'Erro ao apagar produto. O sistema tentou remover vínculos antigos, mas algum registro ainda bloqueou a exclusão.',
    });
  }
});

// CLIENTES
app.get('/clients', authMiddleware, async (req, res) => {
  try {
    const clients = await db.client.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return res.json(clients);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.post('/clients', authMiddleware, async (req, res) => {
  try {
    const client = await db.client.create({
      data: {
        name: String(req.body.name || ''),
        phone: String(req.body.phone || ''),
        email: req.body.email ? String(req.body.email) : null,
        address: req.body.address ? String(req.body.address) : null,
      },
    });

    return res.json(client);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao criar cliente' });
  }
});

app.put('/clients/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const client = await db.client.update({
      where: { id },
      data: {
        name: String(req.body.name || ''),
        phone: String(req.body.phone || ''),
        email: req.body.email ? String(req.body.email) : null,
        address: req.body.address ? String(req.body.address) : null,
      },
    });

    return res.json(client);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao editar cliente' });
  }
});

app.delete('/clients/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const client = await db.client.findUnique({
      where: { id },
    });

    if (!client) {
      return res.status(404).json({
        error: 'Cliente não encontrado.',
      });
    }

    await db.$transaction(async (tx: any) => {
      const clientOrders = await tx.order.findMany({
        where: {
          clientId: id,
        },
        include: {
          items: true,
        },
      });

      for (const order of clientOrders) {
        for (const item of order.items) {
          const product = await tx.product.findUnique({
            where: {
              id: item.productId,
            },
          });

          if (product) {
            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stock: toNumber(product.stock) + toNumber(item.quantity),
              },
            });

            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                type: 'ENTRY',
                quantity: item.quantity,
                note: `Estorno automático do pedido apagado junto com cliente ${id}`,
              },
            });
          }
        }

        await tx.orderItem.deleteMany({
          where: {
            orderId: order.id,
          },
        });

        await tx.financialTransaction.deleteMany({
          where: {
            description: {
              contains: order.id,
            },
          },
        });

        await tx.order.delete({
          where: {
            id: order.id,
          },
        });
      }

      await tx.client.delete({
        where: { id },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      error:
        'Erro ao apagar cliente. O sistema tentou remover pedidos antigos vinculados, mas algum registro ainda bloqueou a exclusão.',
    });
  }
});

// PEDIDOS
app.get('/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await db.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        client: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    const ordersWithStockInfo = orders.map((order: any) => ({
      ...order,
      stockDiscounted: noteHasStockDiscounted(order.note),
      note: cleanInternalStockFlags(order.note),
    }));

    return res.json(ordersWithStockInfo);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar pedidos' });
  }
});

app.post('/orders', authMiddleware, async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    const preparedItems = await Promise.all(
      items.map(async (item: any) => {
        const product = await db.product.findUnique({
          where: {
            id: String(item.productId || ''),
          },
        });

        const quantity = toNumber(item.quantity || 1);

        const unitPrice =
          item.unitPrice !== undefined
            ? toNumber(item.unitPrice)
            : item.price !== undefined
            ? toNumber(item.price)
            : toNumber(product?.salePrice);

        return {
          productId: String(item.productId || ''),
          quantity,
          unitPrice,
          total:
            item.total !== undefined
              ? toNumber(item.total)
              : quantity * unitPrice,
        };
      })
    );

    const total =
      req.body.total !== undefined
        ? toNumber(req.body.total)
        : preparedItems.reduce((sum: number, item: any) => {
            return sum + toNumber(item.total);
          }, 0);

    const discountStockNow = shouldDiscountStock(req.body.discountStockNow);

    const order = await db.$transaction(async (tx: any) => {
      const createdOrder = await tx.order.create({
        data: {
          clientId: req.body.clientId ? String(req.body.clientId) : null,
          status: normalizeOrderStatus(req.body.status),
          total,
          paymentMethod: req.body.paymentMethod
            ? String(req.body.paymentMethod)
            : req.body.paymentStatus
            ? String(req.body.paymentStatus)
            : null,
          note: addStockFlagToNote(
            req.body.note
              ? String(req.body.note)
              : req.body.notes
              ? String(req.body.notes)
              : req.body.returnItems
              ? String(req.body.returnItems)
              : '',
            discountStockNow
          ),
          items: {
            create: preparedItems.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          },
        },
        include: {
          client: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (discountStockNow) {
        await discountOrderStock(tx, createdOrder.id, preparedItems);
      }

      if (total > 0) {
        await tx.financialTransaction.create({
          data: {
            type: 'ENTRY',
            category: 'Venda',
            description: `Entrada automática do pedido ${createdOrder.id}`,
            amount: total,
          },
        });
      }

      return {
        ...createdOrder,
        stockDiscounted: discountStockNow,
        note: cleanInternalStockFlags(createdOrder.note),
      };
    });

    return res.json(order);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao criar pedido' });
  }
});

app.put('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const hasNewItems = Array.isArray(req.body.items);
    const preparedItems = hasNewItems
      ? await prepareOrderItems(req.body.items)
      : [];

    const order = await db.$transaction(async (tx: any) => {
      const existingOrder = await tx.order.findUnique({
        where: { id },
        include: {
          items: true,
        },
      });

      if (!existingOrder) {
        throw new Error('Pedido não encontrado');
      }

      const alreadyDiscounted = noteHasStockDiscounted(existingOrder.note);
      const shouldDiscountNow = shouldDiscountStock(req.body.discountStockNow);
      const finalStockDiscounted = alreadyDiscounted || shouldDiscountNow;

      const newTotal =
        req.body.total !== undefined
          ? toNumber(req.body.total)
          : hasNewItems
          ? preparedItems.reduce((sum: number, item: any) => {
              return sum + toNumber(item.total);
            }, 0)
          : toNumber(existingOrder.total);

      const newNote =
        req.body.note !== undefined
          ? String(req.body.note)
          : req.body.notes !== undefined
          ? String(req.body.notes)
          : req.body.returnItems !== undefined
          ? String(req.body.returnItems)
          : cleanInternalStockFlags(existingOrder.note);

      if (hasNewItems) {
        if (alreadyDiscounted) {
          await restoreOrderStock(tx, id, existingOrder.items);
        }

        await tx.orderItem.deleteMany({
          where: {
            orderId: id,
          },
        });

        if (preparedItems.length > 0) {
          await tx.orderItem.createMany({
            data: preparedItems.map((item: any) => ({
              orderId: id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.total,
            })),
          });
        }

        if (finalStockDiscounted) {
          await discountOrderStock(tx, id, preparedItems);
        }
      } else if (shouldDiscountNow && !alreadyDiscounted) {
        await discountOrderStock(tx, id, existingOrder.items);
      }

      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          clientId:
            req.body.clientId !== undefined
              ? req.body.clientId
                ? String(req.body.clientId)
                : null
              : undefined,
          status: req.body.status
            ? normalizeOrderStatus(req.body.status)
            : undefined,
          total: newTotal,
          paymentMethod: req.body.paymentMethod
            ? String(req.body.paymentMethod)
            : req.body.paymentStatus
            ? String(req.body.paymentStatus)
            : undefined,
          note: addStockFlagToNote(newNote, finalStockDiscounted),
        },
        include: {
          client: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      await tx.financialTransaction.updateMany({
        where: {
          description: {
            contains: id,
          },
          type: 'ENTRY',
        },
        data: {
          amount: newTotal,
        },
      });

      return {
        ...updatedOrder,
        stockDiscounted: noteHasStockDiscounted(updatedOrder.note),
        note: cleanInternalStockFlags(updatedOrder.note),
      };
    });

    return res.json(order);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao editar pedido' });
  }
});

app.delete('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const stockWasDiscounted = noteHasStockDiscounted(order.note);

    await db.$transaction(async (tx: any) => {
      if (stockWasDiscounted) {
        for (const item of order.items) {
          const product = await tx.product.findUnique({
            where: {
              id: item.productId,
            },
          });

          if (product) {
            await tx.product.update({
              where: {
                id: item.productId,
              },
              data: {
                stock: toNumber(product.stock) + toNumber(item.quantity),
              },
            });

            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                type: 'ENTRY',
                quantity: item.quantity,
                note: `Estorno automático do pedido apagado ${id}`,
              },
            });
          }
        }
      }

      await tx.orderItem.deleteMany({
        where: { orderId: id },
      });

      await tx.order.delete({
        where: { id },
      });

      await tx.financialTransaction.deleteMany({
        where: {
          description: {
            contains: id,
          },
        },
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao apagar pedido' });
  }
});

// FINANCEIRO
app.get('/financial-transactions', authMiddleware, async (req, res) => {
  try {
    const transactions = await db.financialTransaction.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return res.json(transactions);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar financeiro' });
  }
});

app.post('/financial-transactions', authMiddleware, async (req, res) => {
  try {
    const transaction = await db.financialTransaction.create({
      data: {
        type:
          String(req.body.type || 'ENTRY').toUpperCase() === 'OUTPUT'
            ? 'OUTPUT'
            : 'ENTRY',
        category: String(req.body.category || ''),
        description: String(req.body.description || ''),
        amount: toNumber(req.body.amount || req.body.value),
      },
    });

    return res.json(transaction);
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ error: 'Erro ao criar lançamento financeiro' });
  }
});

app.delete('/financial-transactions/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    await db.financialTransaction.delete({
      where: { id },
    });

    return res.json({ success: true });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ error: 'Erro ao apagar lançamento financeiro' });
  }
});

// DESPESAS
app.get('/expenses', authMiddleware, async (req, res) => {
  try {
    const expenses = await db.financialTransaction.findMany({
      where: {
        type: 'OUTPUT',
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(expenses);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar despesas' });
  }
});

app.post('/expenses', authMiddleware, async (req, res) => {
  try {
    const expense = await db.financialTransaction.create({
      data: {
        type: 'OUTPUT',
        category: String(req.body.category || 'Despesa'),
        description: String(req.body.description || ''),
        amount:
          req.body.amount !== undefined
            ? toNumber(req.body.amount)
            : toNumber(req.body.value),
      },
    });

    return res.json(expense);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao criar despesa' });
  }
});

// MOVIMENTAÇÕES DE ESTOQUE
app.get('/stock-movements', authMiddleware, async (req, res) => {
  try {
    const movements = await db.stockMovement.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        product: true,
      },
    });

    return res.json(movements);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao buscar movimentações' });
  }
});

app.post('/stock-movements', authMiddleware, async (req, res) => {
  try {
    const movement = await db.$transaction(async (tx: any) => {
      const createdMovement = await tx.stockMovement.create({
        data: {
          productId: String(req.body.productId || ''),
          type:
            String(req.body.type || 'ENTRY').toUpperCase() === 'OUTPUT'
              ? 'OUTPUT'
              : 'ENTRY',
          quantity: toNumber(req.body.quantity),
          note: req.body.note ? String(req.body.note) : null,
        },
      });

      const product = await tx.product.findUnique({
        where: { id: String(req.body.productId || '') },
      });

      if (product) {
        const currentStock = toNumber(product.stock);
        const quantity = toNumber(req.body.quantity);
        const type =
          String(req.body.type || 'ENTRY').toUpperCase() === 'OUTPUT'
            ? 'OUTPUT'
            : 'ENTRY';

        await tx.product.update({
          where: { id: String(req.body.productId || '') },
          data: {
            stock:
              type === 'OUTPUT'
                ? currentStock - quantity
                : currentStock + quantity,
          },
        });
      }

      return createdMovement;
    });

    return res.json(movement);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: 'Erro ao criar movimentação' });
  }
});

const PORT = Number(process.env.PORT || 3333);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
