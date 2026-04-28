/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect, ChangeEvent } from 'react';
import { Calendar, MapPin, Plus, List, Trash2, CheckCircle2, Bus, Users, DollarSign, User, Phone, CreditCard, Edit2, MessageCircle, Filter, Settings, X, ExternalLink, FileText, Shield, CheckSquare, LogOut, FileDown, FileUp, AlertTriangle, Search, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { auth, db, googleProvider, signInWithPopup, signOut } from './firebase';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

interface Event {
  id: string;
  name: string;
  date: string;
  days: number;
  location: string;
  uid: string;
}

interface Transport {
  id: string;
  eventId: string;
  name?: string;
  type: string;
  capacity: number;
  pricePerPerson: number;
  uid: string;
}

interface SeatAssignment {
  id: string;
  transportId: string;
  personId: string;
  seatNumber: number;
  uid: string;
}

interface Person {
  id: string;
  eventId: string;
  name: string;
  phone: string;
  isCaptain?: boolean;
  order?: number;
  uid: string;
}

interface Payment {
  id: string;
  eventId: string;
  personId: string;
  amountPaid: number;
  uid: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'events'>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [transports, setTransports] = useState<Transport[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [seatAssignments, setSeatAssignments] = useState<SeatAssignment[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTransportId, setSelectedTransportId] = useState<string | null>(null);
  const [showSeatMap, setShowSeatMap] = useState(false);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const [passengerSearch, setPassengerSearch] = useState('');
  const [eventViewTab, setEventViewTab] = useState<'transport' | 'payments' | 'people'>('transport');

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText?: string;
    variant?: 'danger' | 'success' | 'indigo';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    confirmText: 'Excluir',
    variant: 'danger'
  });

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    days: '',
    location: ''
  });
  const [transportFormData, setTransportFormData] = useState({
    eventId: '',
    name: '',
    type: '',
    capacity: '',
    pricePerPerson: ''
  });
  const [personFormData, setPersonFormData] = useState({
    name: '',
    phone: '',
    isCaptain: false,
    eventId: ''
  });
  const [paymentFormData, setPaymentFormData] = useState({
    eventId: '',
    personId: '',
    amountPaid: ''
  });

  const [successMessage, setSuccessMessage] = useState('Operação realizada com sucesso.');
  const [showSuccess, setShowSuccess] = useState(false);
  const [showTransportSuccess, setShowTransportSuccess] = useState(false);
  const [showPersonSuccess, setShowPersonSuccess] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingTransportId, setEditingTransportId] = useState<string | null>(null);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showPersonForm, setShowPersonForm] = useState(false);
  const [showTransportForm, setShowTransportForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [importEventId, setImportEventId] = useState('');

  const [pixKey, setPixKey] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('Olá {nome}, tudo bem? Estou passando para lembrar do pagamento do evento {evento}. O valor pendente é de R$ {valor}. Chave PIX: {pix}');
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setEvents([]);
      setTransports([]);
      setPeople([]);
      setPayments([]);
      return;
    }

    const qEvents = query(collection(db, 'events'), where('uid', '==', user.uid));
    const unsubEvents = onSnapshot(qEvents, (snapshot) => {
      setEvents(snapshot.docs.map(doc => doc.data() as Event));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'events'));

    const qTransports = query(collection(db, 'transports'), where('uid', '==', user.uid));
    const unsubTransports = onSnapshot(qTransports, (snapshot) => {
      setTransports(snapshot.docs.map(doc => doc.data() as Transport));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'transports'));

    const qPeople = selectedEventId 
      ? query(collection(db, 'people'), where('uid', '==', user.uid), where('eventId', '==', selectedEventId))
      : query(collection(db, 'people'), where('uid', '==', user.uid));
    const unsubPeople = onSnapshot(qPeople, (snapshot) => {
      const peopleData = snapshot.docs.map(doc => doc.data() as Person);
      // Sort by order, then by name if order is missing or equal
      setPeople(peopleData.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'people'));

    const qPayments = query(collection(db, 'payments'), where('uid', '==', user.uid));
    const unsubPayments = onSnapshot(qPayments, (snapshot) => {
      setPayments(snapshot.docs.map(doc => doc.data() as Payment));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'payments'));

    const qSeatAssignments = query(collection(db, 'seatAssignments'), where('uid', '==', user.uid));
    const unsubSeatAssignments = onSnapshot(qSeatAssignments, (snapshot) => {
      setSeatAssignments(snapshot.docs.map(doc => doc.data() as SeatAssignment));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'seatAssignments'));

    const unsubSettings = onSnapshot(doc(db, 'userSettings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setPixKey(data.pixKey || '');
        setPaymentMessage(data.paymentMessage || 'Olá {nome}, tudo bem? Estou passando para lembrar do pagamento do evento {evento}. O valor pendente é de R$ {valor}. Chave PIX: {pix}');
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `userSettings/${user.uid}`));

    return () => {
      unsubEvents();
      unsubTransports();
      unsubPeople();
      unsubPayments();
      unsubSeatAssignments();
      unsubSettings();
    };
  }, [user, selectedEventId]);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const exportBackup = async () => {
    if (!user) return;
    setIsExporting(true);
    try {
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        userEmail: user.email,
        data: {
          events,
          transports,
          people,
          payments,
          seatAssignments,
          settings: {
            pixKey,
            paymentMessage
          }
        }
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().split('T')[0];
      const fileName = `backup_gestor_eventos_${date}.json`;

      // Try to use Web Share API if available (better for mobile/email)
      let shared = false;
      if (navigator.share && navigator.canShare) {
        try {
          const file = new File([blob], fileName, { type: 'application/json' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Backup Gestor de Eventos',
              text: 'Arquivo de backup dos meus eventos e passageiros.',
              files: [file]
            });
            shared = true;
          }
        } catch (shareError) {
          console.warn('Share failed or was cancelled:', shareError);
          // Don't throw, just let it fallback to download
        }
      }

      if (!shared) {
        // Fallback to traditional download
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      setSuccessMessage('Backup exportado com sucesso!');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error: any) {
      console.error('Export error:', error);
      setSuccessMessage(`Erro ao exportar: ${error.message || 'Permissão negada ou erro desconhecido'}`);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  const importBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.data || !backup.version) {
        throw new Error('Formato de backup inválido.');
      }

      const { events: bEvents, transports: bTransports, people: bPeople, payments: bPayments, seatAssignments: bSeatAssignments, settings: bSettings } = backup.data;

      // Import Settings
      if (bSettings) {
        await setDoc(doc(db, 'userSettings', user.uid), {
          pixKey: bSettings.pixKey || pixKey,
          paymentMessage: bSettings.paymentMessage || paymentMessage
        });
      }

      // Import Events
      if (Array.isArray(bEvents)) {
        for (const event of bEvents) {
          const eventData = {
            id: event.id,
            name: event.name,
            date: event.date,
            days: Number(event.days),
            location: event.location,
            uid: user.uid
          };
          await setDoc(doc(db, 'events', event.id), eventData);
        }
      }

      // Import Transports
      if (Array.isArray(bTransports)) {
        for (const transport of bTransports) {
          const transportData = {
            id: transport.id,
            eventId: transport.eventId,
            name: transport.name || '',
            type: transport.type,
            capacity: Number(transport.capacity),
            pricePerPerson: Number(transport.pricePerPerson),
            uid: user.uid
          };
          await setDoc(doc(db, 'transports', transport.id), transportData);
        }
      }

      // Import People
      if (Array.isArray(bPeople)) {
        for (const person of bPeople) {
          const personData = {
            id: person.id,
            eventId: person.eventId,
            name: person.name,
            phone: person.phone || '',
            isCaptain: !!person.isCaptain,
            order: typeof person.order === 'number' ? person.order : 0,
            uid: user.uid
          };
          await setDoc(doc(db, 'people', person.id), personData);
        }
      }

      // Import Payments
      if (Array.isArray(bPayments)) {
        for (const payment of bPayments) {
          const paymentData = {
            id: payment.id,
            eventId: payment.eventId,
            personId: payment.personId,
            amountPaid: Number(payment.amountPaid),
            uid: user.uid
          };
          await setDoc(doc(db, 'payments', payment.id), paymentData);
        }
      }

      // Import Seat Assignments
      if (Array.isArray(bSeatAssignments)) {
        for (const sa of bSeatAssignments) {
          const saData = {
            id: sa.id,
            transportId: sa.transportId,
            personId: sa.personId,
            seatNumber: Number(sa.seatNumber),
            uid: user.uid
          };
          await setDoc(doc(db, 'seatAssignments', sa.id), saData);
        }
      }

      setSuccessMessage('Backup importado com sucesso!');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
      setShowSettingsModal(false);
    } catch (error) {
      console.error('Import error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'backup/import');
    } finally {
      setIsImporting(false);
      // Reset input
      e.target.value = '';
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await setDoc(doc(db, 'userSettings', user.uid), {
        pixKey,
        paymentMessage
      });
      setShowSettingsModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `userSettings/${user.uid}`);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedEventId(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleWhatsAppClick = (person: Person, pendingAmount: number) => {
    const event = events.find(e => e.id === selectedEventId);
    if (!event) return;

    let message = paymentMessage
      .replace('{nome}', person.name)
      .replace('{evento}', event.name)
      .replace('{valor}', pendingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }))
      .replace('{pix}', pixKey || '[CHAVE PIX NÃO CONFIGURADA]');

    const encodedMessage = encodeURIComponent(message);
    const phone = person.phone.replace(/\D/g, '');
    // Se o telefone não começar com 55 e tiver 10 ou 11 dígitos, adiciona 55
    const finalPhone = (phone.length <= 11 && !phone.startsWith('55')) ? `55${phone}` : phone;
    window.open(`https://wa.me/${finalPhone}?text=${encodedMessage}`, '_blank');
  };

  const assignSeat = async (transportId: string, seatNumber: number, personId: string) => {
    if (!user || !selectedEventId) return;
    try {
      // Check if seat is already taken in THIS transport
      const existing = seatAssignments.find(sa => sa.transportId === transportId && sa.seatNumber === seatNumber);
      if (existing && existing.personId === personId) return; // Already assigned correctly

      // Remove any existing assignment for THIS PERSON in the current event
      const existingForPerson = seatAssignments.find(sa => {
        const t = transports.find(trans => trans.id === sa.transportId);
        return sa.personId === personId && t?.eventId === selectedEventId;
      });

      if (existingForPerson) {
        await deleteDoc(doc(db, 'seatAssignments', existingForPerson.id));
      }

      // If the seat was occupied by someone else, that person becomes unassigned
      if (existing) {
        await deleteDoc(doc(db, 'seatAssignments', existing.id));
      }

      const id = crypto.randomUUID();
      const newAssignment: SeatAssignment = {
        id,
        transportId,
        personId,
        seatNumber,
        uid: user.uid
      };
      await setDoc(doc(db, 'seatAssignments', id), newAssignment);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'seatAssignments/assign');
    }
  };

  const unassignSeat = async (assignmentId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'seatAssignments', assignmentId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `seatAssignments/${assignmentId}`);
    }
  };

  const generateCheckInPDF = () => {
    const event = events.find(e => e.id === selectedEventId);
    if (!event) return;

    const doc = new jsPDF();
    const title = `Lista de Check-in: ${event.name}`;
    const date = `Data: ${event.date}`;
    const location = `Local: ${event.location}`;

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.text(date, 14, 30);
    doc.text(location, 14, 36);

    const headers = [['Nome', ...Array.from({ length: event.days }, (_, i) => [`Dia ${i + 1} (Ida)`, `Dia ${i + 1} (Volta)`]).flat()]];
    const data = people.map(p => [
      p.name,
      ...Array.from({ length: event.days * 2 }, () => '[ ]')
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 45,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8, cellPadding: 2 },
    });

    const fileName = `checkin_${event.name.toLowerCase().replace(/\s+/g, '_')}.pdf`;
    doc.save(fileName);
    return fileName;
  };

  const generateTransportPDF = (transportId: string) => {
    const transport = transports.find(t => t.id === transportId);
    const event = events.find(e => e.id === selectedEventId);
    if (!transport || !event) return;

    const doc = new jsPDF();
    const transportName = transport.name || transport.type;
    
    // Header
    doc.setFillColor(240, 244, 255);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setFontSize(22);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.text('MAPA DE PASSAGEIROS', 105, 18, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setTextColor(71, 85, 105);
    doc.text(`${transportName.toUpperCase()} - ${transport.capacity} LUGARES`, 105, 28, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`EVENTO: ${event.name.toUpperCase()}  |  DATA: ${new Date(event.date).toLocaleDateString('pt-BR')}`, 105, 35, { align: 'center' });

    const assignments = seatAssignments.filter(sa => sa.transportId === transportId);
    
    // Create data for all seats
    const allSeats = [];
    for (let i = 1; i <= transport.capacity; i++) {
      const assignment = assignments.find(sa => sa.seatNumber === i);
      const person = assignment ? people.find(p => p.id === assignment.personId) : null;
      allSeats.push({
        num: i,
        name: person ? person.name : '____________________________________'
      });
    }

    // Split into two columns for the PDF
    const half = Math.ceil(allSeats.length / 2);
    const leftColumn = allSeats.slice(0, half);
    const rightColumn = allSeats.slice(half);

    const tableData = [];
    for (let i = 0; i < half; i++) {
      const left = leftColumn[i];
      const right = rightColumn[i] || { num: '', name: '' };
      tableData.push([
        left.num.toString(), left.name,
        '', // Spacer
        right.num.toString(), right.name
      ]);
    }

    autoTable(doc, {
      startY: 45,
      head: [['Polt.', 'Nome do Passageiro', '', 'Polt.', 'Nome do Passageiro']],
      body: tableData,
      theme: 'plain',
      styles: { 
        fontSize: 9, 
        cellPadding: 2.5,
        textColor: [51, 65, 85]
      },
      headStyles: { 
        fillColor: [248, 250, 252], 
        textColor: [15, 23, 42], 
        fontStyle: 'bold',
        lineWidth: 0.1,
        lineColor: [226, 232, 240],
        cellPadding: 3
      },
      columnStyles: {
        0: { cellWidth: 12, fontStyle: 'bold', halign: 'center' },
        1: { cellWidth: 78 },
        2: { cellWidth: 10 }, // Spacer column
        3: { cellWidth: 12, fontStyle: 'bold', halign: 'center' },
        4: { cellWidth: 78 }
      },
      didDrawCell: (data) => {
        // Draw bottom border for rows
        if (data.section === 'body') {
          doc.setDrawColor(241, 245, 249);
          doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
        }
      }
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}  |  Página ${i} de ${pageCount}`, 105, 285, { align: 'center' });
    }

    doc.save(`lista_passageiros_${transportName.toLowerCase().replace(/\s+/g, '_')}.pdf`);
  };

  const sendPDFToCaptain = () => {
    const captain = people.find(p => p.isCaptain);
    const event = events.find(e => e.id === selectedEventId);
    if (!captain || !event) return;

    const fileName = generateCheckInPDF();
    const message = `Olá ${captain.name}, aqui está a lista de check-in para o evento ${event.name}. Por favor, realize o controle de ida e volta dos passageiros.`;
    const encodedMessage = encodeURIComponent(message);
    const phone = captain.phone.replace(/\D/g, '');
    const finalPhone = (phone.length <= 11 && !phone.startsWith('55')) ? `55${phone}` : phone;
    
    // Since we can't send the file directly via wa.me, we inform the user to send the downloaded file.
    setSuccessMessage(`O PDF "${fileName}" foi gerado e baixado. Agora você será redirecionado para o WhatsApp do Capitão ${captain.name}. Por favor, anexe o arquivo baixado na conversa.`);
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      window.open(`https://wa.me/${finalPhone}?text=${encodedMessage}`, '_blank');
    }, 4000);
  };

  const getTotalPaidByPersonForEvent = (personId: string, eventId: string) => {
    return payments
      .filter(p => p.personId === personId && p.eventId === eventId)
      .reduce((sum, p) => sum + p.amountPaid, 0);
  };

  const getEventSummary = (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return null;

    const eventPayments = payments.filter(p => p.eventId === eventId);
    const totalCollected = eventPayments.reduce((sum, p) => sum + p.amountPaid, 0);
    
    const transport = transports.find(t => t.eventId === eventId);
    const pricePerPerson = transport?.pricePerPerson || 0;
    const totalExpected = (pricePerPerson * event.days) * people.length;
    const remaining = totalExpected - totalCollected;

    const fullyPaidCount = people.filter(person => {
      const totalPaid = getTotalPaidByPersonForEvent(person.id, eventId);
      return totalPaid >= (pricePerPerson * event.days);
    }).length;

    return {
      totalCollected,
      uniquePeoplePaid: new Set(eventPayments.map(p => p.personId)).size,
      fullyPaidCount,
      totalExpected,
      remaining
    };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.date || !formData.days || !formData.location || !user) return;

    try {
      const id = editingEventId || crypto.randomUUID();
      const eventData: Event = {
        id,
        name: formData.name,
        date: formData.date,
        days: Number(formData.days),
        location: formData.location,
        uid: user.uid
      };
      await setDoc(doc(db, 'events', id), eventData);
      setSuccessMessage(editingEventId ? 'Evento atualizado com sucesso!' : 'Evento criado com sucesso!');
      setEditingEventId(null);
      setFormData({ name: '', date: '', days: '', location: '' });
      setShowEventForm(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `events/${editingEventId || 'new'}`);
    }
  };

  const handleTransportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const targetEventId = transportFormData.eventId || selectedEventId;
    if (!targetEventId || !transportFormData.type || !transportFormData.capacity || !transportFormData.pricePerPerson || !user) return;

    try {
      const id = editingTransportId || crypto.randomUUID();
      const transportData: Transport = {
        id,
        eventId: targetEventId,
        name: transportFormData.name,
        type: transportFormData.type,
        capacity: Number(transportFormData.capacity),
        pricePerPerson: Number(transportFormData.pricePerPerson),
        uid: user.uid
      };
      await setDoc(doc(db, 'transports', id), transportData);
      setSuccessMessage(editingTransportId ? 'Transporte atualizado com sucesso!' : 'Transporte adicionado com sucesso!');
      setEditingTransportId(null);
      setTransportFormData({ eventId: '', name: '', type: '', capacity: '', pricePerPerson: '' });
      setShowTransportForm(false);
      setShowTransportSuccess(true);
      setTimeout(() => setShowTransportSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `transports/${editingTransportId || 'new'}`);
    }
  };

  const handlePersonSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const targetEventId = personFormData.eventId || selectedEventId;
    if (!personFormData.name || !personFormData.phone || !targetEventId || !user) return;

    try {
      const id = editingPersonId || crypto.randomUUID();
      const personData: Person = {
        id,
        eventId: targetEventId,
        name: personFormData.name,
        phone: personFormData.phone,
        isCaptain: personFormData.isCaptain,
        uid: user.uid,
        order: editingPersonId ? people.find(p => p.id === editingPersonId)?.order : people.length
      };
      await setDoc(doc(db, 'people', id), personData);
      setSuccessMessage(editingPersonId ? 'Pessoa atualizada com sucesso!' : 'Pessoa adicionada com sucesso!');
      setEditingPersonId(null);
      setPersonFormData({ name: '', phone: '', isCaptain: false, eventId: '' });
      setShowPersonForm(false);
      setShowPersonSuccess(true);
      setTimeout(() => setShowPersonSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `people/${editingPersonId || 'new'}`);
    }
  };

  const handleImportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const targetEventId = selectedEventId || importEventId;
    if (!importData || !targetEventId || !user) return;

    try {
      const lines = importData.split('\n').filter(line => line.trim());
      const promises = lines.map((line, index) => {
        // Try to split by comma, then semicolon, then tab, then multiple spaces
        let parts = line.split(/[,;\t]|\s{2,}/).map(p => p.trim());
        
        // If only one part, maybe it's just a name
        if (parts.length === 1) {
          parts = [parts[0], ''];
        }

        const id = crypto.randomUUID();
        const personData: Person = {
          id,
          eventId: targetEventId,
          name: parts[0] || 'Sem Nome',
          phone: parts[1] || '',
          isCaptain: false,
          uid: user.uid,
          order: people.length + index
        };
        return setDoc(doc(db, 'people', id), personData);
      });

      await Promise.all(promises);
      setImportData('');
      setShowImportModal(false);
      setSuccessMessage(`${lines.length} pessoas importadas com sucesso!`);
      setShowPersonSuccess(true);
      setTimeout(() => setShowPersonSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'people/import');
    }
  };

  const registerPayment = async (amount: number) => {
    const event = events.find(e => e.id === selectedEventId);
    if (!paymentFormData.personId || !event || !user) return;

    try {
      const id = crypto.randomUUID();
      const newPayment: Payment = {
        id,
        eventId: selectedEventId!,
        personId: paymentFormData.personId,
        amountPaid: amount,
        uid: user.uid
      };
      await setDoc(doc(db, 'payments', id), newPayment);
      setSuccessMessage('Pagamento registrado com sucesso!');
      setShowPaymentSuccess(true);
      setTimeout(() => setShowPaymentSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments/new');
    }
  };

  const handleQuickPayment = async (personId: string, amount: number) => {
    if (!selectedEventId || !user || amount <= 0) return;

    try {
      const id = crypto.randomUUID();
      const newPayment: Payment = {
        id,
        eventId: selectedEventId,
        personId,
        amountPaid: amount,
        uid: user.uid
      };
      await setDoc(doc(db, 'payments', id), newPayment);
      setSuccessMessage('Pagamento registrado com sucesso!');
      setShowPaymentSuccess(true);
      setTimeout(() => setShowPaymentSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments/quick');
    }
  };

  const handlePaymentSubmit = (e: FormEvent) => {
    e.preventDefault();
    // This is now handled by individual buttons, but we keep it for compatibility if needed
    // or we can remove it if we don't use the form submit anymore.
  };

  const startEditEvent = (event: Event) => {
    setFormData({
      name: event.name,
      date: event.date,
      days: event.days.toString(),
      location: event.location
    });
    setEditingEventId(event.id);
    setShowEventForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startEditTransport = (transport: Transport) => {
    setTransportFormData({
      eventId: transport.eventId,
      name: transport.name || '',
      type: transport.type,
      capacity: transport.capacity.toString(),
      pricePerPerson: transport.pricePerPerson.toString()
    });
    setEditingTransportId(transport.id);
    setShowTransportForm(true);
  };

  const startEditPerson = (person: Person) => {
    setPersonFormData({
      name: person.name,
      phone: person.phone,
      isCaptain: person.isCaptain || false,
      eventId: person.eventId
    });
    setEditingPersonId(person.id);
    setShowPersonForm(true);
  };

  const startEditPayment = (payment: Payment) => {
    setPaymentFormData({
      eventId: payment.eventId,
      personId: payment.personId,
      amountPaid: payment.amountPaid.toString()
    });
    setEditingPaymentId(payment.id);
    setShowPaymentForm(true);
  };

  const deleteEvent = async (id: string) => {
    try {
      // Delete the event itself
      await deleteDoc(doc(db, 'events', id));
      
      // Clean up related data
      // Transports
      const qTransports = query(collection(db, 'transports'), where('eventId', '==', id));
      const transportDocs = transports.filter(t => t.eventId === id);
      for (const t of transportDocs) {
        await deleteDoc(doc(db, 'transports', t.id));
      }

      // People
      const qPeople = query(collection(db, 'people'), where('eventId', '==', id));
      const peopleDocs = people.filter(p => p.eventId === id);
      for (const p of peopleDocs) {
        await deleteDoc(doc(db, 'people', p.id));
      }

      // Payments
      const qPayments = query(collection(db, 'payments'), where('eventId', '==', id));
      const paymentDocs = payments.filter(p => p.eventId === id);
      for (const p of paymentDocs) {
        await deleteDoc(doc(db, 'payments', p.id));
      }

      // Seat Assignments
      const assignmentDocs = seatAssignments.filter(sa => {
        const t = transports.find(trans => trans.id === sa.transportId);
        return t?.eventId === id;
      });
      for (const sa of assignmentDocs) {
        await deleteDoc(doc(db, 'seatAssignments', sa.id));
      }

      if (selectedEventId === id) {
        setSelectedEventId(null);
      }
      
      setSuccessMessage('Evento e dados relacionados excluídos com sucesso!');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `events/${id}`);
    }
  };

  const deleteTransport = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transports', id));
      
      // Clean up seat assignments for this transport
      const assignmentDocs = seatAssignments.filter(sa => sa.transportId === id);
      for (const sa of assignmentDocs) {
        await deleteDoc(doc(db, 'seatAssignments', sa.id));
      }

      setSuccessMessage('Transporte excluído com sucesso!');
      setShowTransportSuccess(true);
      setTimeout(() => setShowTransportSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transports/${id}`);
    }
  };

  const deletePerson = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'people', id));
      
      // Clean up related payments
      const personPayments = payments.filter(p => p.personId === id);
      for (const p of personPayments) {
        await deleteDoc(doc(db, 'payments', p.id));
      }

      // Clean up seat assignments for this person
      const personAssignments = seatAssignments.filter(sa => sa.personId === id);
      for (const sa of personAssignments) {
        await deleteDoc(doc(db, 'seatAssignments', sa.id));
      }
      
      setSuccessMessage('Passageiro e pagamentos excluídos com sucesso!');
      setShowPersonSuccess(true);
      setTimeout(() => setShowPersonSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `people/${id}`);
    }
  };

  const deletePayment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'payments', id));
      setSuccessMessage('Pagamento excluído com sucesso!');
      setShowPaymentSuccess(true);
      setTimeout(() => setShowPaymentSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `payments/${id}`);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-zinc-200 text-center"
        >
          <div className="bg-indigo-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Calendar className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 mb-2">Gestor de Eventos</h1>
          <p className="text-zinc-500 mb-8">Faça login para salvar seus eventos na nuvem e acessá-los de qualquer lugar.</p>
          <button
            onClick={handleLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebase/anonymous-scan.png" alt="Google" className="w-6 h-6 hidden" />
            Entrar com Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-indigo-600" />
            Gestor de Eventos
          </h1>
          <div className="flex items-center gap-3">
          <div className="flex bg-zinc-100 p-1 rounded-xl overflow-x-auto max-w-full no-scrollbar shadow-inner">
            <button
              onClick={() => {
                setActiveTab('events');
                setSelectedEventId(null);
              }}
              className={`flex items-center gap-2.5 px-6 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap active:scale-95 ${
                activeTab === 'events' 
                ? 'bg-white text-indigo-600 shadow-sm' 
                : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Eventos
            </button>
          </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettingsModal(true)}
                className="p-2.5 text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-zinc-200 hover:border-indigo-200 transition-all active:scale-95 shadow-sm bg-white"
                title="Configurações de Pagamento"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2.5 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-xl border border-zinc-200 hover:border-red-200 transition-all active:scale-95 shadow-sm bg-white"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'events' && (
            !selectedEventId ? (
              <motion.div
                key="events-list"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Event Form Modal */}
                <AnimatePresence>
                  {showEventForm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => {
                          setShowEventForm(false);
                          setEditingEventId(null);
                          setFormData({ name: '', date: '', days: '', location: '' });
                        }}
                        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
                      />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
                      >
                        <div className="p-5 sm:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                          <h2 className="text-lg sm:text-xl font-bold text-zinc-900">
                            {editingEventId ? 'Editar Evento' : 'Novo Evento'}
                          </h2>
                          <button
                            onClick={() => {
                              setShowEventForm(false);
                              setEditingEventId(null);
                              setFormData({ name: '', date: '', days: '', location: '' });
                            }}
                            className="p-2.5 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors active:scale-95"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">
                          <div>
                            <label htmlFor="name" className="block text-sm font-medium text-zinc-700 mb-1">
                              Nome do Evento
                            </label>
                            <input
                              type="text"
                              id="name"
                              required
                              value={formData.name}
                              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Ex: Conferência de Tecnologia"
                              className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="date" className="block text-sm font-medium text-zinc-700 mb-1">
                                Data
                              </label>
                              <input
                                type="date"
                                id="date"
                                required
                                value={formData.date}
                                onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                              />
                            </div>
                            <div>
                              <label htmlFor="days" className="block text-sm font-medium text-zinc-700 mb-1">
                                Dias
                              </label>
                              <input
                                type="number"
                                id="days"
                                required
                                min="1"
                                value={formData.days}
                                onChange={e => setFormData(prev => ({ ...prev, days: e.target.value }))}
                                placeholder="Ex: 3"
                                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                              />
                            </div>
                          </div>

                          <div>
                            <label htmlFor="location" className="block text-sm font-medium text-zinc-700 mb-1">
                              Local
                            </label>
                            <div className="relative">
                              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                              <input
                                type="text"
                                id="location"
                                required
                                value={formData.location}
                                onChange={e => setFormData(prev => ({ ...prev, location: e.target.value }))}
                                placeholder="Cidade, Estado ou Endereço"
                                className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                              />
                            </div>
                          </div>

                          <button
                            type="submit"
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                          >
                            {editingEventId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                            {editingEventId ? 'Salvar Alterações' : 'Cadastrar Evento'}
                          </button>
                        </form>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Event List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-lg font-semibold text-zinc-900">Seus Eventos</h3>
                    <AnimatePresence>
                      {showSuccess && (
                        <motion.div
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-2 text-xs font-medium"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {successMessage}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {events.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-zinc-300">
                      <List className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
                      <p className="text-zinc-500 text-sm">Nenhum evento cadastrado.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {events.map((event) => (
                        <motion.div
                          layout
                          key={event.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-zinc-200 flex items-center justify-between group cursor-pointer hover:border-indigo-300 transition-colors"
                          onClick={() => setSelectedEventId(event.id)}
                        >
                          <div className="flex gap-3 items-center">
                            <div className="bg-indigo-50 p-2 rounded-xl text-indigo-600 shrink-0">
                              <Calendar className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-zinc-900 text-sm md:text-base truncate">{event.name}</h3>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {new Date(event.date).toLocaleDateString('pt-BR')} ({event.days} {event.days === 1 ? 'dia' : 'dias'})
                                </span>
                                <span className="flex items-center gap-1 truncate max-w-[150px]">
                                  <MapPin className="w-3.5 h-3.5" />
                                  {event.location}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => startEditEvent(event)}
                              className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all active:scale-90"
                              title="Editar Evento"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setConfirmModal({
                                  show: true,
                                  title: 'Excluir Evento',
                                  message: 'Tem certeza que deseja excluir este evento? Todos os dados relacionados (transportes, passageiros e pagamentos) também serão excluídos.',
                                  confirmText: 'Excluir',
                                  variant: 'danger',
                                  onConfirm: () => {
                                    deleteEvent(event.id);
                                    setConfirmModal(prev => ({ ...prev, show: false }));
                                  }
                                });
                              }}
                              className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                              title="Excluir Evento"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="event-dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Dashboard Header */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSelectedEventId(null)}
                    className="flex items-center gap-2 text-zinc-500 hover:text-indigo-600 font-bold text-sm transition-all active:scale-95 px-2 py-1 rounded-lg hover:bg-indigo-50"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                    Voltar
                  </button>
                  <div className="flex bg-zinc-100 p-1 rounded-xl overflow-x-auto max-w-[200px] sm:max-w-full no-scrollbar shadow-inner">
                    <button
                      onClick={() => setEventViewTab('transport')}
                      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap active:scale-95 ${
                        eventViewTab === 'transport' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      <Bus className="w-4 h-4" />
                      Transporte
                    </button>
                    <button
                      onClick={() => setEventViewTab('people')}
                      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap active:scale-95 ${
                        eventViewTab === 'people' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      Pessoas
                    </button>
                    <button
                      onClick={() => setEventViewTab('payments')}
                      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap active:scale-95 ${
                        eventViewTab === 'payments' 
                        ? 'bg-white text-indigo-600 shadow-sm' 
                        : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      <DollarSign className="w-4 h-4" />
                      Pagamentos
                    </button>
                  </div>
                </div>

                {/* Event Info Card */}
                {events.find(e => e.id === selectedEventId) && (
                  <div className="bg-white p-3 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 md:mb-6">
                      <div>
                        <h2 className="text-lg md:text-xl font-bold text-zinc-900">{events.find(e => e.id === selectedEventId)?.name}</h2>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5 text-xs md:text-sm text-zinc-500">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" />
                            {new Date(events.find(e => e.id === selectedEventId)!.date).toLocaleDateString('pt-BR')}
                            <span className="text-zinc-400 font-medium">({events.find(e => e.id === selectedEventId)?.days} {events.find(e => e.id === selectedEventId)?.days === 1 ? 'dia' : 'dias'})</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" />
                            {events.find(e => e.id === selectedEventId)?.location}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Financial Summary */}
                    {getEventSummary(selectedEventId!) && (
                      <div className="space-y-4 md:space-y-6">
                        <div className="grid grid-cols-3 gap-2 md:gap-4">
                          <div className="bg-zinc-50 p-2 md:p-4 rounded-xl border border-zinc-100">
                            <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-0.5">Total</p>
                            <p className="text-xs md:text-lg font-bold text-zinc-900">
                              R$ {getEventSummary(selectedEventId!)?.totalExpected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <div className="bg-emerald-50 p-2 md:p-4 rounded-xl border border-emerald-100">
                            <p className="text-[8px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-0.5">Pago</p>
                            <p className="text-xs md:text-lg font-bold text-emerald-900">
                              R$ {getEventSummary(selectedEventId!)?.totalCollected.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <div className="bg-amber-50 p-2 md:p-4 rounded-xl border border-amber-100">
                            <p className="text-[8px] md:text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-0.5">Falta</p>
                            <p className="text-xs md:text-lg font-bold text-amber-900">
                              R$ {getEventSummary(selectedEventId!)?.remaining.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>


                      </div>
                    )}
                  </div>
                )}

              {/* Dashboard Content */}
              <div className="mt-6">
                  {eventViewTab === 'transport' && (
                      <div className="space-y-6">
                        {/* Transport Form Modal */}
                        <AnimatePresence>
                          {showTransportForm && (
                            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => {
                                  setShowTransportForm(false);
                                  setEditingTransportId(null);
                                  setTransportFormData({ eventId: '', name: '', type: '', capacity: '', pricePerPerson: '' });
                                }}
                                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
                              />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
                              >
                                <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                                  <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                                    <Bus className="w-5 h-5 text-indigo-600" />
                                    {editingTransportId ? 'Editar Transporte' : 'Novo Transporte'}
                                  </h3>
                                  <button
                                    onClick={() => {
                                      setShowTransportForm(false);
                                      setEditingTransportId(null);
                                      setTransportFormData({ eventId: '', name: '', type: '', capacity: '', pricePerPerson: '' });
                                    }}
                                    className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                                  >
                                    <X className="w-5 h-5" />
                                  </button>
                                </div>
                                
                                <form onSubmit={handleTransportSubmit} className="p-6 space-y-5">
                                  <input type="hidden" value={selectedEventId || ''} />
                                  <div>
                                    <label htmlFor="name" className="block text-sm font-medium text-zinc-700 mb-1">Nome do Veículo (Opcional)</label>
                                    <input
                                      type="text"
                                      id="name"
                                      value={transportFormData.name}
                                      onChange={e => setTransportFormData(prev => ({ ...prev, name: e.target.value, eventId: selectedEventId! }))}
                                      placeholder="Ex: Ônibus 1, Van Executiva"
                                      className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div>
                                    <label htmlFor="type" className="block text-sm font-medium text-zinc-700 mb-1">Tipo</label>
                                    <input
                                      type="text"
                                      id="type"
                                      required
                                      value={transportFormData.type}
                                      onChange={e => setTransportFormData(prev => ({ ...prev, type: e.target.value, eventId: selectedEventId! }))}
                                      placeholder="Ex: Ônibus, Van"
                                      className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-zinc-700 mb-1">Capacidade</label>
                                      <input
                                        type="number"
                                        required
                                        value={transportFormData.capacity}
                                        onChange={e => setTransportFormData(prev => ({ ...prev, capacity: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-sm font-medium text-zinc-700 mb-1">Preço/Pessoa</label>
                                      <input
                                        type="number"
                                        required
                                        step="0.01"
                                        value={transportFormData.pricePerPerson}
                                        onChange={e => setTransportFormData(prev => ({ ...prev, pricePerPerson: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                      />
                                    </div>
                                  </div>
                                  <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-[0.98]">
                                    {editingTransportId ? 'Salvar Alterações' : 'Adicionar Transporte'}
                                  </button>
                                </form>
                              </motion.div>
                            </div>
                          )}
                        </AnimatePresence>

                        <div className="flex items-center justify-between px-1">
                          <h3 className="text-lg font-semibold text-zinc-900">Transportes do Evento</h3>
                          <AnimatePresence>
                            {showTransportSuccess && (
                              <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-2 text-xs font-medium"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                {successMessage}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <div className="grid gap-4">
                        {transports.filter(t => t.eventId === selectedEventId).map(transport => (
                          <div key={transport.id} className="bg-white p-2 md:p-5 rounded-2xl border border-zinc-200 flex items-center justify-between group">
                            <div className="flex gap-2 md:gap-4 items-center">
                              <div className="bg-indigo-50 p-1.5 md:p-3 rounded-xl text-indigo-600 shrink-0">
                                <Bus className="w-4 h-4 md:w-6 h-6" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-bold text-zinc-900 text-sm md:text-base truncate">{transport.name || transport.type}</h4>
                                <p className="text-xs md:text-sm text-zinc-500 truncate">
                                  {transport.name ? transport.type + ' • ' : ''}
                                  {transport.capacity} pessoas • R$ {transport.pricePerPerson.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/pessoa
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-1 md:gap-2 items-center">
                              <button
                                onClick={() => {
                                  setSelectedTransportId(transport.id);
                                  setShowSeatMap(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-xl text-[11px] md:text-xs font-bold uppercase transition-all active:scale-95 shadow-sm shadow-emerald-100/20"
                                title="Mapa de Assentos"
                              >
                                <CheckSquare className="w-4 h-4" />
                                <span className="hidden sm:inline">Mapa de Assentos</span>
                              </button>
                              <button
                                onClick={() => generateTransportPDF(transport.id)}
                                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-[11px] md:text-xs font-bold uppercase transition-all active:scale-95 shadow-sm shadow-indigo-100/20"
                                title="Exportar Lista em PDF"
                              >
                                <FileDown className="w-4 h-4" />
                                <span className="hidden sm:inline">PDF</span>
                              </button>
                              <button
                                onClick={() => startEditTransport(transport)}
                                className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all active:scale-90"
                                title="Editar Transporte"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setConfirmModal({
                                    show: true,
                                    title: 'Excluir Transporte',
                                    message: 'Tem certeza que deseja excluir este transporte?',
                                    confirmText: 'Excluir',
                                    variant: 'danger',
                                    onConfirm: () => {
                                      deleteTransport(transport.id);
                                      setConfirmModal(prev => ({ ...prev, show: false }));
                                    }
                                  });
                                }}
                                className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                                title="Excluir Transporte"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {eventViewTab === 'people' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-lg font-semibold text-zinc-900">Passageiros do Evento</h3>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            onClick={() => setShowImportModal(true)}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200 transition-all text-xs font-bold w-full sm:w-auto active:scale-95"
                          >
                            <FileUp className="w-4 h-4" />
                            Importar
                          </button>
                          <button
                            onClick={() => {
                              setEditingPersonId(null);
                              setPersonFormData({ name: '', phone: '', isCaptain: false, eventId: selectedEventId || '' });
                              setShowPersonForm(true);
                            }}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all text-xs font-bold shadow-lg shadow-indigo-100 w-full sm:w-auto active:scale-95"
                          >
                            <Plus className="w-4 h-4" />
                            Novo Passageiro
                          </button>
                        </div>
                      </div>
                      
                      {people.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-zinc-300">
                          <Users className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
                          <p className="text-zinc-500 text-sm">Nenhuma pessoa cadastrada para este evento.</p>
                        </div>
                      ) : (
                        <div className="grid gap-4">
                          {people.map((person) => (
                            <motion.div
                              layout
                              key={person.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-white p-2 md:p-5 rounded-2xl shadow-sm border border-zinc-200 flex items-center justify-between group"
                            >
                              <div className="flex gap-2 md:gap-4 items-center min-w-0">
                                <div className="bg-indigo-50 p-1.5 md:p-3 rounded-xl text-indigo-600 shrink-0">
                                  <User className="w-4 h-4 md:w-6 h-6" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-zinc-900 text-sm md:text-lg truncate">{person.name}</h3>
                                    {person.isCaptain && (
                                      <span className="bg-indigo-100 text-indigo-700 text-[10px] md:text-[11px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                                        <Shield className="w-2.5 h-2.5 md:w-3 h-3" />
                                        Capitão
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-xs md:text-sm text-zinc-500">
                                    <Phone className="w-3.5 h-3.5 md:w-4 h-4" />
                                    {person.phone}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-1 md:gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditPerson(person)}
                                  className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all active:scale-90"
                                  title="Editar Passageiro"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setConfirmModal({
                                      show: true,
                                      title: 'Excluir Passageiro',
                                      message: 'Tem certeza que deseja excluir este passageiro? Todos os pagamentos deste passageiro também serão excluídos.',
                                      confirmText: 'Excluir',
                                      variant: 'danger',
                                      onConfirm: () => {
                                        deletePerson(person.id);
                                        setConfirmModal(prev => ({ ...prev, show: false }));
                                      }
                                    });
                                  }}
                                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                                  title="Excluir Passageiro"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {eventViewTab === 'payments' && (
                    <div className="space-y-6">
                      {/* Payment Form Modal */}
                      <AnimatePresence>
                        {showPaymentForm && (
                          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              onClick={() => {
                                setShowPaymentForm(false);
                                setEditingPaymentId(null);
                                setPaymentFormData({ eventId: '', personId: '', amountPaid: '' });
                              }}
                              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
                            />
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: 20 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: 20 }}
                              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
                            >
                              <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                                <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                                  <CreditCard className="w-5 h-5 text-indigo-600" />
                                  {editingPaymentId ? 'Editar Pagamento' : 'Novo Pagamento'}
                                </h3>
                                <button
                                  onClick={() => {
                                    setShowPaymentForm(false);
                                    setEditingPaymentId(null);
                                    setPaymentFormData({ eventId: '', personId: '', amountPaid: '' });
                                  }}
                                  className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                                >
                                  <X className="w-5 h-5" />
                                </button>
                              </div>
                              
                              <div className="p-6 space-y-5">
                                <div>
                                  <label className="block text-sm font-medium text-zinc-700 mb-1">Passageiro</label>
                                  <select
                                    required
                                    value={paymentFormData.personId}
                                    onChange={e => setPaymentFormData(prev => ({ ...prev, personId: e.target.value, eventId: selectedEventId! }))}
                                    className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                  >
                                    <option value="">Selecione...</option>
                                    {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </div>
                                
                                {paymentFormData.personId && (
                                  <div className="space-y-4">
                                    <p className="text-sm font-medium text-zinc-700">Registrar Pagamento por Dia:</p>
                                    <div className="grid grid-cols-2 gap-3">
                                      {Array.from({ length: events.find(e => e.id === selectedEventId)?.days || 0 }).map((_, i) => {
                                        const event = events.find(e => e.id === selectedEventId);
                                        const transport = transports.find(t => t.eventId === selectedEventId);
                                        const amount = transport?.pricePerPerson || 0;
                                        
                                        const personPayments = payments.filter(p => p.eventId === selectedEventId && p.personId === paymentFormData.personId);
                                        const isPaid = personPayments.length > i;

                                        return (
                                          <button
                                            key={i}
                                            onClick={() => registerPayment(amount)}
                                            disabled={isPaid}
                                            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                              isPaid 
                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 cursor-default' 
                                                : 'bg-white border-zinc-200 text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 active:scale-95'
                                            }`}
                                          >
                                            <span className="text-[10px] font-bold uppercase tracking-wider mb-1">Dia {i + 1}</span>
                                            <span className="font-bold">R$ {amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                            {isPaid && <CheckCircle2 className="w-4 h-4 mt-1" />}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    
                                    <button 
                                      onClick={() => {
                                        const event = events.find(e => e.id === selectedEventId);
                                        const transport = transports.find(t => t.eventId === selectedEventId);
                                        if (!event || !transport) return;
                                        const personPayments = payments.filter(p => p.eventId === selectedEventId && p.personId === paymentFormData.personId);
                                        const remainingDays = event.days - personPayments.length;
                                        if (remainingDays > 0) {
                                          for (let j = 0; j < remainingDays; j++) {
                                            registerPayment(transport.pricePerPerson);
                                          }
                                        }
                                      }}
                                      className="w-full py-3.5 px-4 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-zinc-200"
                                    >
                                      Pagar Todos os Dias
                                    </button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          </div>
                        )}
                      </AnimatePresence>

                        <div className="space-y-8">
                          <div className="flex items-center justify-between px-1">
                            <h3 className="text-lg font-semibold text-zinc-900">Controle de Pagamentos</h3>
                            <AnimatePresence>
                              {showPaymentSuccess && (
                                <motion.div
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 20 }}
                                  className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-2 text-xs font-medium"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  {successMessage}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {/* Summary by Person */}
                        <div className="grid gap-4">
                          <div className="flex items-center justify-between px-1">
                            <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Resumo por Pessoa</h4>
                            <div className="flex bg-zinc-100 p-1 rounded-lg">
                              <button
                                onClick={() => setPaymentStatusFilter('all')}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                                  paymentStatusFilter === 'all' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                                }`}
                              >
                                Todos ({people.length})
                              </button>
                              <button
                                onClick={() => setPaymentStatusFilter('paid')}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                                  paymentStatusFilter === 'paid' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500'
                                }`}
                              >
                                Pagos ({people.filter(person => {
                                  const totalPaid = getTotalPaidByPersonForEvent(person.id, selectedEventId!);
                                  const event = events.find(e => e.id === selectedEventId);
                                  const transport = transports.find(t => t.eventId === selectedEventId);
                                  const pricePerPerson = transport?.pricePerPerson || 0;
                                  const price = pricePerPerson * (event?.days || 0);
                                  return price > 0 && totalPaid >= price;
                                }).length})
                              </button>
                              <button
                                onClick={() => setPaymentStatusFilter('pending')}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                                  paymentStatusFilter === 'pending' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500'
                                }`}
                              >
                                Pendentes ({people.filter(person => {
                                  const totalPaid = getTotalPaidByPersonForEvent(person.id, selectedEventId!);
                                  const event = events.find(e => e.id === selectedEventId);
                                  const transport = transports.find(t => t.eventId === selectedEventId);
                                  const pricePerPerson = transport?.pricePerPerson || 0;
                                  const price = pricePerPerson * (event?.days || 0);
                                  return !(price > 0 && totalPaid >= price);
                                }).length})
                              </button>
                            </div>
                          </div>
                          {people.filter(person => {
                            const totalPaid = getTotalPaidByPersonForEvent(person.id, selectedEventId!);
                            const event = events.find(e => e.id === selectedEventId);
                            const transport = transports.find(t => t.eventId === selectedEventId);
                            const pricePerPerson = transport?.pricePerPerson || 0;
                            const price = pricePerPerson * (event?.days || 0);
                            const isFullyPaid = price > 0 && totalPaid >= price;

                            if (paymentStatusFilter === 'paid') return isFullyPaid;
                            if (paymentStatusFilter === 'pending') return !isFullyPaid;
                            return true;
                          }).map(person => {
                            const totalPaid = getTotalPaidByPersonForEvent(person.id, selectedEventId!);
                            const event = events.find(e => e.id === selectedEventId);
                            const transport = transports.find(t => t.eventId === selectedEventId);
                            const pricePerPerson = transport?.pricePerPerson || 0;
                            const price = pricePerPerson * (event?.days || 0);
                            const percentage = price > 0 ? Math.min((totalPaid / price) * 100, 100) : 0;
                            const isFullyPaid = price > 0 && totalPaid >= price;

                            return (
                              <div key={person.id} className="bg-white p-3 md:p-5 rounded-2xl border border-zinc-200">
                                <div className="flex justify-between items-start mb-3 md:mb-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <h4 className="font-bold text-zinc-900 text-sm md:text-base truncate">{person.name}</h4>
                                      {person.isCaptain && (
                                        <span className="bg-indigo-100 text-indigo-700 text-[10px] md:text-[11px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                                          <Shield className="w-2.5 h-2.5 md:w-3 h-3" />
                                          Capitão
                                        </span>
                                      )}
                                    </div>
                                  <div className="flex flex-col items-end gap-2 shrink-0">
                                    <span className={`px-2.5 py-1 md:px-3 md:py-1 rounded-full text-[10px] md:text-[11px] font-bold uppercase tracking-wider ${
                                      isFullyPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                    }`}>
                                      {isFullyPaid ? 'Pago' : 'Pendente'}
                                    </span>
                                    {!isFullyPaid && (
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => {
                                            setConfirmModal({
                                              show: true,
                                              title: 'Confirmar Pagamento',
                                              message: `Deseja registrar o pagamento total de R$ ${(price - totalPaid).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para ${person.name}?`,
                                              confirmText: 'Pago',
                                              variant: 'success',
                                              onConfirm: () => {
                                                handleQuickPayment(person.id, price - totalPaid);
                                                setConfirmModal(prev => ({ ...prev, show: false }));
                                              }
                                            });
                                          }}
                                          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-indigo-100"
                                          title="Informar pagamento total"
                                        >
                                          <DollarSign className="w-3.5 h-3.5 md:w-4 h-4" />
                                          Pagar
                                        </button>
                                        <button
                                          onClick={() => handleWhatsAppClick(person, price - totalPaid)}
                                          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[10px] md:text-[11px] font-bold uppercase tracking-wider transition-all active:scale-95 shadow-lg shadow-emerald-100"
                                        >
                                          <MessageCircle className="w-3.5 h-3.5 md:w-4 h-4" />
                                          Cobrar
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full bg-zinc-100 h-2 md:h-2.5 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percentage}%` }}
                                    className={`h-full transition-all ${isFullyPaid ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                  />
                                </div>
                                <div className="flex justify-between mt-2 text-[10px] md:text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                                  <span>{percentage.toFixed(0)}%</span>
                                  <span className="text-zinc-600">R$ {price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Individual Payment History */}
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider px-1">Histórico de Pagamentos</h4>
                          {payments.filter(p => p.eventId === selectedEventId).length === 0 ? (
                            <div className="text-center py-8 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                              <p className="text-zinc-500 text-sm italic">Nenhum pagamento registrado para este evento.</p>
                            </div>
                          ) : (
                            <div className="grid gap-3">
                          {payments
                                .filter(p => {
                                  if (p.eventId !== selectedEventId) return false;
                                  
                                  const person = people.find(pers => pers.id === p.personId);
                                  if (!person) return true; // Should not happen but keep it

                                  const totalPaid = getTotalPaidByPersonForEvent(person.id, selectedEventId!);
                                  const event = events.find(e => e.id === selectedEventId);
                                  const transport = transports.find(t => t.eventId === selectedEventId);
                                  const pricePerPerson = transport?.pricePerPerson || 0;
                                  const price = pricePerPerson * (event?.days || 0);
                                  const isFullyPaid = price > 0 && totalPaid >= price;

                                  if (paymentStatusFilter === 'paid') return isFullyPaid;
                                  if (paymentStatusFilter === 'pending') return !isFullyPaid;
                                  return true;
                                })
                                .map(payment => {
                                  const person = people.find(p => p.id === payment.personId);
                                  return (
                                    <div key={payment.id} className="bg-white p-2.5 md:p-4 rounded-xl border border-zinc-200 flex items-center justify-between group hover:border-indigo-200 transition-colors">
                                      <div className="flex items-center gap-2 md:gap-3">
                                        <div className="bg-emerald-50 p-1.5 md:p-2 rounded-lg text-emerald-600">
                                          <DollarSign className="w-3.5 h-3.5 md:w-4 h-4" />
                                        </div>
                                        <div>
                                          <p className="font-bold text-zinc-900 text-sm md:text-base">{person?.name || 'Pessoa excluída'}</p>
                                          <p className="text-xs text-emerald-600 font-medium">R$ {payment.amountPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                      </div>
                                      <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => startEditPayment(payment)}
                                          className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all active:scale-90"
                                          title="Editar Pagamento"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => {
                                            setConfirmModal({
                                              show: true,
                                              title: 'Excluir Pagamento',
                                              message: 'Tem certeza que deseja excluir este pagamento?',
                                              confirmText: 'Excluir',
                                              variant: 'danger',
                                              onConfirm: () => {
                                                deletePayment(payment.id);
                                                setConfirmModal(prev => ({ ...prev, show: false }));
                                              }
                                            });
                                          }}
                                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all active:scale-90"
                                          title="Excluir Pagamento"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}


                </div>
              </motion.div>
        )
      )}

        </AnimatePresence>

        {/* Floating Action Button */}
        {activeTab === 'events' && !selectedEventId && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowEventForm(true)}
            className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-xl shadow-indigo-200 flex items-center justify-center z-50"
          >
            <Plus className="w-7 h-7" />
          </motion.button>
        )}

        {/* FAB for Transport */}
        {activeTab === 'events' && selectedEventId && eventViewTab === 'transport' && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowTransportForm(true)}
            className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-xl shadow-indigo-200 flex items-center justify-center z-50"
          >
            <Bus className="w-7 h-7" />
          </motion.button>
        )}

        {/* FAB for Payments */}
        {activeTab === 'events' && selectedEventId && eventViewTab === 'payments' && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowPaymentForm(true)}
            className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-xl shadow-indigo-200 flex items-center justify-center z-50"
          >
            <CreditCard className="w-7 h-7" />
          </motion.button>
        )}

        {/* FAB for People */}
        {activeTab === 'events' && selectedEventId && eventViewTab === 'people' && (
          <>
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setImportEventId('');
                setShowImportModal(true);
              }}
              className="fixed bottom-24 right-9 w-12 h-12 bg-zinc-100 text-zinc-600 rounded-full shadow-lg flex items-center justify-center z-50 border border-zinc-200"
            >
              <FileUp className="w-6 h-6" />
            </motion.button>
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                setEditingPersonId(null);
                setPersonFormData({ name: '', phone: '', isCaptain: false, eventId: selectedEventId || '' });
                setShowPersonForm(true);
              }}
              className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-xl shadow-indigo-200 flex items-center justify-center z-50"
            >
              <Users className="w-7 h-7" />
            </motion.button>
          </>
        )}

        {/* Person Form Modal */}
        <AnimatePresence>
          {showPersonForm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setShowPersonForm(false);
                  setEditingPersonId(null);
                  setPersonFormData({ name: '', phone: '', isCaptain: false });
                }}
                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                  <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
                    <User className="w-5 h-5 text-indigo-600" />
                    {editingPersonId ? 'Editar Pessoa' : 'Nova Pessoa'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowPersonForm(false);
                      setEditingPersonId(null);
                      setPersonFormData({ name: '', phone: '', isCaptain: false });
                    }}
                    className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <form onSubmit={handlePersonSubmit} className="p-6 space-y-5">
                  <div>
                    <label htmlFor="targetEventId" className="block text-sm font-medium text-zinc-700 mb-1">
                      Evento
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <select
                        id="targetEventId"
                        required
                        value={personFormData.eventId || selectedEventId || ''}
                        onChange={e => setPersonFormData(prev => ({ ...prev, eventId: e.target.value }))}
                        className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all appearance-none"
                      >
                        <option value="">Selecione um evento...</option>
                        {events.map(event => (
                          <option key={event.id} value={event.id}>
                            {event.name} ({new Date(event.date).toLocaleDateString('pt-BR')})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="personName" className="block text-sm font-medium text-zinc-700 mb-1">
                      Nome Completo
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        id="personName"
                        required
                        value={personFormData.name}
                        onChange={e => setPersonFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Ex: João Silva"
                        className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-zinc-700 mb-1">
                      Telefone / WhatsApp
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="tel"
                        id="phone"
                        required
                        value={personFormData.phone}
                        onChange={e => setPersonFormData(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="Ex: (11) 99999-9999"
                        className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-200">
                    <button
                      type="button"
                      onClick={() => setPersonFormData(prev => ({ ...prev, isCaptain: !prev.isCaptain }))}
                      className={`w-12 h-6 rounded-full transition-all relative ${personFormData.isCaptain ? 'bg-indigo-600' : 'bg-zinc-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${personFormData.isCaptain ? 'left-7' : 'left-1'}`} />
                    </button>
                    <div className="flex items-center gap-2">
                      <Shield className={`w-4 h-4 ${personFormData.isCaptain ? 'text-indigo-600' : 'text-zinc-400'}`} />
                      <span className="text-sm font-medium text-zinc-700">Definir como Capitão</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3.5 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    {editingPersonId ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    {editingPersonId ? 'Salvar Alterações' : 'Adicionar à Lista'}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Import Modal */}
        <AnimatePresence>
          {showImportModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowImportModal(false)}
                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                  <div className="flex items-center gap-2">
                    <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
                      <FileUp className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900">Importar Passageiros</h3>
                  </div>
                  <button
                    onClick={() => setShowImportModal(false)}
                    className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleImportSubmit} className="p-6 space-y-6">
                  {!selectedEventId && (
                    <div>
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                        Selecionar Evento
                      </label>
                      <select
                        required
                        value={importEventId}
                        onChange={e => setImportEventId(e.target.value)}
                        className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                      >
                        <option value="">Selecione um evento...</option>
                        {events.map(event => (
                          <option key={event.id} value={event.id}>{event.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                      Lista de Passageiros
                    </label>
                    <textarea
                      rows={10}
                      value={importData}
                      onChange={e => setImportData(e.target.value)}
                      placeholder="Cole aqui a lista de nomes e telefones.&#10;Exemplo:&#10;João Silva, 11999999999&#10;Maria Oliveira, 11888888888"
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm resize-none font-mono"
                    />
                    <p className="mt-2 text-[10px] text-zinc-400 leading-relaxed">
                      * Formatos aceitos: "Nome, Telefone", "Nome; Telefone", "Nome [Tab] Telefone" ou "Nome [Espaços] Telefone". Uma pessoa por linha.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmar Importação
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Seat Map Modal */}
        <AnimatePresence>
          {showSeatMap && selectedTransportId && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setShowSeatMap(false);
                  setSelectedSeatNumber(null);
                }}
                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-5xl h-[90vh] md:h-[80vh] bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col"
              >
                {/* Header */}
                <div className="p-4 md:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600">
                      <Bus className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-zinc-900">
                        {transports.find(t => t.id === selectedTransportId)?.name || transports.find(t => t.id === selectedTransportId)?.type}
                      </h3>
                      <p className="text-xs text-zinc-500">Mapa de Assentos - {seatAssignments.filter(sa => sa.transportId === selectedTransportId).length} / {transports.find(t => t.id === selectedTransportId)?.capacity} ocupados</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => generateTransportPDF(selectedTransportId)}
                      className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-lg shadow-indigo-100"
                    >
                      <FileDown className="w-4 h-4" />
                      <span className="hidden sm:inline">Exportar PDF</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowSeatMap(false);
                        setSelectedSeatNumber(null);
                      }}
                      className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                  {/* Left: Seat Map */}
                  <div className={`flex-1 overflow-y-auto p-4 md:p-8 bg-zinc-50/30 transition-all ${selectedSeatNumber && isMobile ? 'pb-80' : ''}`}>
                    <div className="max-w-md mx-auto bg-white p-6 md:p-10 rounded-[3rem] shadow-sm border border-zinc-100 border-t-[12px] border-t-zinc-200 relative mb-10">
                      {/* Driver Area */}
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full mb-4 flex items-center justify-center p-4 bg-zinc-200 w-24 h-12 rounded-t-3xl shadow-sm">
                        <div className="w-8 h-8 rounded-full border-2 border-zinc-400 flex items-center justify-center">
                          <div className="w-4 h-1 bg-zinc-400 rounded-full" />
                        </div>
                      </div>

                      <div className="grid grid-cols-5 gap-2 md:gap-3">
                        {Array.from({ length: Math.ceil((transports.find(t => t.id === selectedTransportId)?.capacity || 0) / 4) }).map((_, rowIndex) => (
                           <div key={rowIndex} className="col-span-5 grid grid-cols-5 gap-2 md:gap-3 mb-2">
                             {[0, 1, 3, 4].map(colIndex => {
                               const seatIndex = rowIndex * 4 + (colIndex > 2 ? colIndex - 1 : colIndex);
                               const seatNum = seatIndex + 1;
                               const maxCap = transports.find(t => t.id === selectedTransportId)?.capacity || 0;
                               if (seatNum > maxCap) {
                                 return <div key={colIndex} className="aspect-square" />;
                               }

                               const assignment = seatAssignments.find(sa => sa.transportId === selectedTransportId && sa.seatNumber === seatNum);
                               const person = assignment ? people.find(p => p.id === assignment.personId) : null;
                               const isSelected = selectedSeatNumber === seatNum;
                               
                               return (
                                 <button
                                   key={colIndex}
                                   onClick={() => setSelectedSeatNumber(isSelected ? null : seatNum)}
                                   className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center p-1 transition-all relative group ${
                                     person 
                                       ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm shadow-emerald-100' 
                                       : isSelected 
                                         ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-md ring-4 ring-indigo-500/20'
                                         : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-300 active:scale-95'
                                   }`}
                                 >
                                   <span className={`text-[10px] md:text-xs font-black ${isSelected ? 'scale-110' : ''} transition-transform`}>{seatNum}</span>
                                   {person && <User className="w-3 h-3 md:w-3.5 h-3.5 mt-0.5 md:mt-1 font-bold" />}
                                   
                                   {/* Tooltip for desktop */}
                                   {(person && !isMobile) && (
                                     <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[10px] py-1.5 px-3 rounded-lg whitespace-nowrap opacity-0 md:group-hover:opacity-100 pointer-events-none z-20 transition-all shadow-xl">
                                       {person.name}
                                       <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-zinc-900" />
                                     </div>
                                   )}
                                 </button>
                               );
                             })}
                             {/* Aisle */}
                             <div className="col-start-3" />
                           </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right: Assignment Panel */}
                  <motion.div 
                    initial={false}
                    animate={{ 
                      y: (selectedSeatNumber || !isMobile) ? 0 : '100%',
                    }}
                    className={`fixed md:relative bottom-0 left-0 right-0 md:translate-y-0 w-full md:w-80 border-t md:border-t-0 md:border-l border-zinc-100 flex flex-col bg-white shrink-0 z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-none rounded-t-[2.5rem] md:rounded-none h-80 md:h-auto overflow-hidden`}
                  >
                    <div className="p-5 md:p-6 border-b border-zinc-100 bg-zinc-50/30 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                        {selectedSeatNumber ? (
                          <>
                            <span className="w-2.5 h-6 bg-indigo-500 rounded-full" />
                            Assento {selectedSeatNumber}
                          </>
                        ) : 'Selecione um lugar'}
                      </h4>
                      <button 
                        onClick={() => setSelectedSeatNumber(null)}
                        className="p-2 md:hidden hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors active:scale-95"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 md:p-6">
                      {selectedSeatNumber ? (
                        <>
                          {seatAssignments.find(sa => sa.transportId === selectedTransportId && sa.seatNumber === selectedSeatNumber) ? (
                            <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 overflow-hidden transition-all shadow-sm">
                              <p className="text-[10px] uppercase font-black text-emerald-600 mb-1 tracking-widest">Ocupado por:</p>
                              <div className="flex items-center gap-3 mb-5">
                                <div className="bg-emerald-200 p-2 rounded-xl">
                                  <User className="w-5 h-5 text-emerald-700" />
                                </div>
                                <p className="text-base font-bold text-emerald-900 truncate">
                                  {people.find(p => p.id === seatAssignments.find(sa => sa.transportId === selectedTransportId && sa.seatNumber === selectedSeatNumber)?.personId)?.name}
                                </p>
                              </div>
                              <button
                                onClick={() => {
                                  const assignment = seatAssignments.find(sa => sa.transportId === selectedTransportId && sa.seatNumber === selectedSeatNumber);
                                  if (assignment) unassignSeat(assignment.id);
                                }}
                                className="w-full py-3.5 bg-white text-red-600 border border-red-200 rounded-2xl text-xs font-bold uppercase hover:bg-red-50 transition-all flex items-center justify-center gap-2 active:scale-95 shadow-sm"
                              >
                                <Trash2 className="w-4 h-4" />
                                Remover da Cadeira
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-zinc-400" />
                                <input
                                  type="text"
                                  placeholder="Buscar passageiro..."
                                  value={passengerSearch}
                                  onChange={e => setPassengerSearch(e.target.value)}
                                  className="w-full pl-11 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                              </div>

                              <div className="space-y-2">
                                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1 mb-1">Escolher Passageiro</p>
                                {people
                                  .filter(person => {
                                    const searchMatch = person.name.toLowerCase().includes(passengerSearch.toLowerCase());
                                    const isAssignedInThisEvent = seatAssignments.some(sa => {
                                      const t = transports.find(trans => trans.id === sa.transportId);
                                      return sa.personId === person.id && t?.eventId === selectedEventId;
                                    });
                                    return searchMatch && !isAssignedInThisEvent;
                                  })
                                  .slice(0, 5)
                                  .map(person => (
                                    <button
                                      key={person.id}
                                      onClick={() => {
                                        assignSeat(selectedTransportId!, selectedSeatNumber, person.id);
                                        setSelectedSeatNumber(null);
                                        setPassengerSearch('');
                                      }}
                                      className="w-full p-4 bg-white border border-zinc-100 rounded-2xl text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all active:scale-[0.98] flex items-center gap-3 shadow-sm"
                                    >
                                      <div className="bg-zinc-100 p-2 rounded-xl">
                                        <User className="w-4 h-4 text-zinc-500" />
                                      </div>
                                      <span className="font-bold text-sm text-zinc-700">{person.name}</span>
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="hidden md:block bg-indigo-50 p-6 rounded-3xl border border-indigo-100 text-center">
                          <div className="w-16 h-16 bg-white rounded-2xl shadow-sm mx-auto mb-4 flex items-center justify-center">
                            <Info className="w-8 h-8 text-indigo-500" />
                          </div>
                          <p className="text-sm text-indigo-700 leading-relaxed font-bold">
                            Selecione uma cadeira vazia no mapa do veículo para atribuir um passageiro a ela.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettingsModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSettingsModal(false)}
                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
              >
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                  <div className="flex items-center gap-2">
                    <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
                      <Settings className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900">Configurações de Cobrança</h3>
                  </div>
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={saveSettings} className="p-6 space-y-6">
                  <div>
                    <label htmlFor="pixKey" className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                      Chave PIX
                    </label>
                    <div className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        id="pixKey"
                        value={pixKey}
                        onChange={e => setPixKey(e.target.value)}
                        placeholder="CPF, E-mail, Celular ou Chave Aleatória"
                        className="w-full pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="paymentMessage" className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                      Mensagem de Cobrança
                    </label>
                    <textarea
                      id="paymentMessage"
                      rows={5}
                      value={paymentMessage}
                      onChange={e => setPaymentMessage(e.target.value)}
                      placeholder="Personalize sua mensagem..."
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm resize-none"
                    />
                    <div className="mt-2 p-3 bg-indigo-50 rounded-xl">
                      <p className="text-[10px] text-indigo-600 leading-relaxed font-medium">
                        <strong>Variáveis disponíveis:</strong><br />
                        <code className="bg-white/50 px-1 rounded">{"{nome}"}</code>, 
                        <code className="bg-white/50 px-1 rounded">{"{evento}"}</code>, 
                        <code className="bg-white/50 px-1 rounded">{"{valor}"}</code>, 
                        <code className="bg-white/50 px-1 rounded">{"{pix}"}</code>
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-zinc-100 space-y-4">
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                      Backup e Restauração
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={exportBackup}
                        disabled={isExporting}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-zinc-100 text-zinc-700 rounded-2xl hover:bg-zinc-200 transition-all text-xs font-bold active:scale-95 disabled:opacity-50"
                      >
                        <FileDown className="w-4 h-4" />
                        {isExporting ? 'Exportando...' : 'Exportar Backup'}
                      </button>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".json"
                          onChange={importBackup}
                          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                          disabled={isImporting}
                        />
                        <button
                          type="button"
                          disabled={isImporting}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-zinc-100 text-zinc-700 rounded-2xl hover:bg-zinc-200 transition-all text-xs font-bold active:scale-95 disabled:opacity-50"
                        >
                          <FileUp className="w-4 h-4" />
                          {isImporting ? 'Importando...' : 'Importar Backup'}
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-relaxed text-center">
                      O backup inclui todos os eventos, passageiros, transportes e pagamentos.
                    </p>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    Salvar Configurações
                  </button>

                  {deferredPrompt && (
                    <button
                      type="button"
                      onClick={handleInstallClick}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                    >
                      <FileDown className="w-5 h-5" />
                      Instalar Aplicativo (PWA)
                    </button>
                  )}
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        {/* Confirmation Modal */}
        <AnimatePresence>
          {confirmModal.show && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden"
              >
                <div className="p-6 text-center">
                  <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                    confirmModal.variant === 'success' ? 'bg-emerald-100 text-emerald-600' : 
                    confirmModal.variant === 'indigo' ? 'bg-indigo-100 text-indigo-600' : 
                    'bg-red-100 text-red-600'
                  }`}>
                    {confirmModal.variant === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                  </div>
                  <h3 className="text-lg font-bold text-zinc-900 mb-2">{confirmModal.title}</h3>
                  <p className="text-sm text-zinc-500 mb-6">{confirmModal.message}</p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                      className="px-4 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-2xl transition-all active:scale-95"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={confirmModal.onConfirm}
                      className={`px-4 py-3 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95 ${
                        confirmModal.variant === 'success' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' :
                        confirmModal.variant === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100' :
                        'bg-red-600 hover:bg-red-700 shadow-red-100'
                      }`}
                    >
                      {confirmModal.confirmText || 'Confirmar'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
