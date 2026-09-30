import { z } from "zod";

// Digits, spaces and the punctuation a written number uses. Deliberately not
// locale-specific: staff write 0911 111 111, +251 911 111 111 and
// (0911) 111-111, and all three are the same number.
const phone = z
  .string()
  .trim()
  .min(7, "A phone number needs at least 7 digits")
  .max(24)
  .regex(
    /^[+()\d][\d\s()+-]*$/,
    "Use digits, spaces, and + ( ) - only",
  );

// Supervisors and Sales are plain users: a role plus a branch.
// The OWNER is never created through this module and never has a branch.
export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  phone,
  role: z.enum(["SUPERVISOR", "SALES"]),
  branchId: z.string().min(1),
});

// Editing an existing user. Every field optional, but at least one required.
export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    phone: phone.optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    {
      message: "Provide at least one field to update",
    },
  );

export const updateUserStatusSchema = z.object({
  isActive: z.boolean(),
});

// Self-service: any signed-in user editing their own login details.
export const updateOwnProfileSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    email: z.string().email().optional(),
    phone: phone.optional(),
  })
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    {
      message: "Provide at least one field to update",
    },
  );

// Changing your own password requires proving you know the current one.
export const changeOwnPasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .refine(
    (data) => data.currentPassword !== data.newPassword,
    {
      message: "The new password must be different",
      path: ["newPassword"],
    },
  );

// Move a user to a different branch.
export const assignBranchSchema = z.object({
  branchId: z.string().min(1),
});

// Replace a branch's supervisor with an existing user, in one transaction.
export const replaceSupervisorSchema = z.object({
  newSupervisorId: z.string().min(1),
});

// Filters for listing users.
export const listUsersQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  role: z.enum(["OWNER", "SUPERVISOR", "SALES"]).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
