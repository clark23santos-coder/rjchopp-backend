import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface TokenPayload {
  id: string;
  role: string;
}

export function roleMiddleware(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: 'Token não informado' });
    }

    const [, token] = authHeader.split(' ');

    try {
      const decoded = jwt.verify(token, 'rjchopp_secret') as TokenPayload;

      if (!allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ message: 'Acesso negado' });
      }

      return next();
    } catch {
      return res.status(401).json({ message: 'Token inválido' });
    }
  };
}