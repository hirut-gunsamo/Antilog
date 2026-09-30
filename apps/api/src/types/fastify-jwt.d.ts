import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: string;
      role: "OWNER" | "SUPERVISOR" | "SALES";
    };

    user: {
      userId: string;
      role: "OWNER" | "SUPERVISOR" | "SALES";
    };
  }
}