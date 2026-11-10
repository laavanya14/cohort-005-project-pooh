import { UserRole } from "~/db/schema";

/** How each user role is written in UI copy, in GLOSSARY.md terms. */
export const userRoleLabels: Record<UserRole, string> = {
  [UserRole.Student]: "Student",
  [UserRole.Instructor]: "Instructor",
  [UserRole.PlatformAdmin]: "Platform admin",
};
