-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "PassStatus" AS ENUM ('valid', 'used', 'cancelled');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateEnum
CREATE TYPE "CheckinResult" AS ENUM ('ok', 'already_used', 'invalid', 'cancelled');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'confirmed');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('admin', 'gate', 'system');

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "organiserName" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "gatesOpenAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "logoUrl" TEXT,
    "brandColour" TEXT NOT NULL DEFAULT '#4f46e5',
    "helplineNumber" TEXT,
    "termsText" TEXT NOT NULL DEFAULT '',
    "maxPassesPerBooking" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" CHAR(12) NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passCount" INTEGER NOT NULL,
    "amount" DECIMAL(10,2),
    "category" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'active',
    "uploadId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pass" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "passNo" INTEGER NOT NULL,
    "code" CHAR(12) NOT NULL,
    "status" "PassStatus" NOT NULL DEFAULT 'valid',
    "usedAt" TIMESTAMPTZ(3),
    "usedGate" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "waMessageId" TEXT,
    "template" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "errorCode" TEXT,
    "errorText" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checkin" (
    "id" UUID NOT NULL,
    "passId" UUID,
    "gate" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "result" "CheckinResult" NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "clientRef" TEXT,
    "scannedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Checkin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "validCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "previewRows" JSONB,
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gate_name_key" ON "Gate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_orderId_key" ON "Ticket"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_phone_idx" ON "Ticket"("phone");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_code_key" ON "Pass"("code");

-- CreateIndex
CREATE INDEX "Pass_status_idx" ON "Pass"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Pass_ticketId_passNo_key" ON "Pass"("ticketId", "passNo");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Message_ticketId_template_key" ON "Message"("ticketId", "template");

-- CreateIndex
CREATE UNIQUE INDEX "Checkin_clientRef_key" ON "Checkin"("clientRef");

-- CreateIndex
CREATE INDEX "Checkin_passId_idx" ON "Checkin"("passId");

-- CreateIndex
CREATE INDEX "Checkin_gate_scannedAt_idx" ON "Checkin"("gate", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkin" ADD CONSTRAINT "Checkin_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Event settings are a single row; Prisma cannot express this, so it is enforced here.
ALTER TABLE "Event" ADD CONSTRAINT "Event_single_row" CHECK ("id" = 1);
