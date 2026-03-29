/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect } from 'react';
import { Calendar, MapPin, Plus, List, Trash2, CheckCircle2, Bus, Users, DollarSign, User, Phone, CreditCard, Edit2, MessageCircle, Filter, Settings, X, ExternalLink, FileText, Shield, CheckSquare, LogOut, GripVertical, FileDown, FileUp } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
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
  type: string;
  capacity: number;
  pricePerPerson: number;
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
  const [activeTab, setActiveTab] = useState<'events' | 'people'>('events');
  const [events, setEvents] = useState<Event[]>([]);
  const [transports, setTransports] = useState<Transport[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventViewTab, setEventViewTab] = useState<'transport' | 'payments' | 'people' | 'ordered-list'>('transport');

  const [formData, setFormData] = useState({
    name: '',
    date: '',
    days: '',
    location: ''
  });
  const [transportFormData, setTransportFormData] = useState({
    eventId: '',
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
      unsubSettings();
    };
  }, [user, selectedEventId]);

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

  const generateOrderedPDF = () => {
    const doc = new jsPDF();
    const title = `Lista de Pessoas Ordenada`;
    const date = new Date().toLocaleDateString('pt-BR');

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.text(`Data de Geração: ${date}`, 14, 30);

    const headers = [['#', 'Nome', 'Telefone']];
    const data = people.map((p, index) => [
      (index + 1).toString(),
      p.name,
      p.phone
    ]);

    autoTable(doc, {
      head: headers,
      body: data,
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 10, cellPadding: 3 },
    });

    doc.save(`lista_ordenada_${date.replace(/\//g, '-')}.pdf`);
  };

  const updatePeopleOrder = async (newOrder: Person[]) => {
    if (!user) return;
    try {
      // Update local state immediately for smooth UI
      setPeople(newOrder.map((p, index) => ({ ...p, order: index })));
      
      // Update Firestore
      const promises = newOrder.map((person, index) => {
        return setDoc(doc(db, 'people', person.id), {
          ...person,
          order: index
        });
      });
      await Promise.all(promises);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'people/reorder');
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
        type: transportFormData.type,
        capacity: Number(transportFormData.capacity),
        pricePerPerson: Number(transportFormData.pricePerPerson),
        uid: user.uid
      };
      await setDoc(doc(db, 'transports', id), transportData);
      setSuccessMessage(editingTransportId ? 'Transporte atualizado com sucesso!' : 'Transporte adicionado com sucesso!');
      setEditingTransportId(null);
      setTransportFormData({ eventId: '', type: '', capacity: '', pricePerPerson: '' });
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
      await deleteDoc(doc(db, 'events', id));
      // Payments and transports should ideally be deleted too, but for simplicity we'll just delete the event
      // In a real app, you'd use a batch or cloud function to clean up related data.
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `events/${id}`);
    }
  };

  const deleteTransport = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transports', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transports/${id}`);
    }
  };

  const deletePerson = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'people', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `people/${id}`);
    }
  };

  const deletePayment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'payments', id));
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
            <div className="flex bg-zinc-100 p-1 rounded-lg overflow-x-auto max-w-full">
              <button
                onClick={() => {
                  setActiveTab('events');
                  setSelectedEventId(null);
                }}
                className={`px-6 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === 'events' 
                  ? 'bg-white text-zinc-900 shadow-sm' 
                  : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
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
                        <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
                          <h2 className="text-xl font-bold text-zinc-900">
                            {editingEventId ? 'Editar Evento' : 'Novo Evento'}
                          </h2>
                          <button
                            onClick={() => {
                              setShowEventForm(false);
                              setEditingEventId(null);
                              setFormData({ name: '', date: '', days: '', location: '' });
                            }}
                            className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
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
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] md:text-xs text-zinc-500">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(event.date).toLocaleDateString('pt-BR')} ({event.days} {event.days === 1 ? 'dia' : 'dias'})
                                </span>
                                <span className="flex items-center gap-1 truncate max-w-[150px]">
                                  <MapPin className="w-3 h-3" />
                                  {event.location}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => startEditEvent(event)}
                              className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                              title="Editar evento"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteEvent(event.id)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title="Excluir evento"
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
                    className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                    Voltar para Eventos
                  </button>
                  <div className="flex bg-zinc-100 p-1 rounded-lg overflow-x-auto max-w-full">
                    <button
                      onClick={() => setEventViewTab('transport')}
                      className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                        eventViewTab === 'transport' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Transporte
                    </button>
                    <button
                      onClick={() => setEventViewTab('people')}
                      className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                        eventViewTab === 'people' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Pessoas
                    </button>
                    <button
                      onClick={() => setEventViewTab('payments')}
                      className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                        eventViewTab === 'payments' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Pagamentos
                    </button>
                    <button
                      onClick={() => setEventViewTab('ordered-list')}
                      className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                        eventViewTab === 'ordered-list' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Lista Ordenada
                    </button>
                  </div>
                </div>

                {/* Event Info Card */}
                {events.find(e => e.id === selectedEventId) && (
                  <div className="bg-white p-3 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3 md:mb-6">
                      <div>
                        <h2 className="text-base md:text-xl font-bold text-zinc-900">{events.find(e => e.id === selectedEventId)?.name}</h2>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] md:text-sm text-zinc-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(events.find(e => e.id === selectedEventId)!.date).toLocaleDateString('pt-BR')}
                            <span className="text-zinc-400">({events.find(e => e.id === selectedEventId)?.days} {events.find(e => e.id === selectedEventId)?.days === 1 ? 'dia' : 'dias'})</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
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

                        {/* PDF Actions */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={generateCheckInPDF}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-zinc-200 hover:border-indigo-200 text-zinc-700 hover:text-indigo-600 rounded-xl font-bold text-[11px] md:text-sm transition-all active:scale-95 shadow-sm"
                          >
                            <FileText className="w-4 h-4 md:w-5 h-5" />
                            Baixar Lista (PDF)
                          </button>
                          <button
                            onClick={sendPDFToCaptain}
                            disabled={!people.some(p => p.isCaptain)}
                            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[11px] md:text-sm transition-all active:scale-95 shadow-sm ${
                              people.some(p => p.isCaptain)
                              ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-100'
                              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                            }`}
                          >
                            <MessageCircle className="w-4 h-4 md:w-5 h-5" />
                            Enviar ao Capitão
                          </button>
                          {!people.some(p => p.isCaptain) && (
                            <p className="text-[10px] text-zinc-400 text-center sm:col-span-2 italic">
                              * Defina uma pessoa como Capitão na aba "Pessoas" para habilitar o envio.
                            </p>
                          )}
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
                                  setTransportFormData({ eventId: '', type: '', capacity: '', pricePerPerson: '' });
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
                                      setTransportFormData({ eventId: '', type: '', capacity: '', pricePerPerson: '' });
                                    }}
                                    className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                                  >
                                    <X className="w-5 h-5" />
                                  </button>
                                </div>
                                
                                <form onSubmit={handleTransportSubmit} className="p-6 space-y-5">
                                  <input type="hidden" value={selectedEventId || ''} />
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
                                <h4 className="font-bold text-zinc-900 text-sm md:text-base truncate">{transport.type}</h4>
                                <p className="text-[10px] md:text-sm text-zinc-500 truncate">{transport.capacity} pessoas • R$ {transport.pricePerPerson.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/pessoa</p>
                              </div>
                            </div>
                            <div className="flex gap-1 md:gap-2">
                              <button onClick={() => startEditTransport(transport)} className="p-1.5 text-zinc-400 hover:text-indigo-600"><Edit2 className="w-4 h-4 md:w-5 h-5" /></button>
                              <button onClick={() => deleteTransport(transport.id)} className="p-1.5 text-zinc-400 hover:text-red-500"><Trash2 className="w-4 h-4 md:w-5 h-5" /></button>
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
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowImportModal(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-all text-xs font-bold"
                          >
                            <FileUp className="w-3.5 h-3.5" />
                            Importar
                          </button>
                          <button
                            onClick={() => {
                              setEditingPersonId(null);
                              setPersonFormData({ name: '', phone: '', isCaptain: false, eventId: selectedEventId || '' });
                              setShowPersonForm(true);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all text-xs font-bold shadow-lg shadow-indigo-100"
                          >
                            <Plus className="w-3.5 h-3.5" />
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
                                      <span className="bg-indigo-100 text-indigo-700 text-[7px] md:text-[9px] font-black uppercase px-1 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                                        <Shield className="w-2 h-2 md:w-2.5 h-2.5" />
                                        Capitão
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-[10px] md:text-sm text-zinc-500">
                                    <Phone className="w-3 h-3 md:w-3.5 h-3.5" />
                                    {person.phone}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-1 md:gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditPerson(person)}
                                  className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                  title="Editar pessoa"
                                >
                                  <Edit2 className="w-4 h-4 md:w-5 h-5" />
                                </button>
                                <button
                                  onClick={() => deletePerson(person.id)}
                                  className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                  title="Remover pessoa"
                                >
                                  <Trash2 className="w-4 h-4 md:w-5 h-5" />
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
                                        <span className="bg-indigo-100 text-indigo-700 text-[8px] md:text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                                          <Shield className="w-2 h-2 md:w-2.5 h-2.5" />
                                          Capitão
                                        </span>
                                      )}
                                    </div>
                                  <div className="flex flex-col items-end gap-1.5 md:gap-2 shrink-0">
                                    <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[9px] md:text-[10px] font-bold uppercase tracking-wider ${
                                      isFullyPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                    }`}>
                                      {isFullyPaid ? 'Pago' : 'Pendente'}
                                    </span>
                                    {!isFullyPaid && (
                                      <button
                                        onClick={() => handleWhatsAppClick(person, price - totalPaid)}
                                        className="flex items-center gap-1 px-2 py-1 md:px-3 md:py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[9px] md:text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 shadow-sm shadow-emerald-100"
                                      >
                                        <MessageCircle className="w-3 h-3 md:w-3.5 h-3.5" />
                                        Cobrar
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="w-full bg-zinc-100 h-1.5 md:h-2 rounded-full overflow-hidden">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percentage}%` }}
                                    className={`h-full transition-all ${isFullyPaid ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                  />
                                </div>
                                <div className="flex justify-between mt-1.5 text-[9px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                  <span>{percentage.toFixed(0)}%</span>
                                  <span>R$ {price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
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
                                          <p className="font-bold text-zinc-900 text-[13px] md:text-sm">{person?.name || 'Pessoa excluída'}</p>
                                          <p className="text-[11px] md:text-xs text-emerald-600 font-medium">R$ {payment.amountPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                      </div>
                                      <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => startEditPayment(payment)}
                                          className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                          title="Editar pagamento"
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                          onClick={() => deletePayment(payment.id)}
                                          className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                          title="Excluir pagamento"
                                        >
                                          <Trash2 className="w-4 h-4" />
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

                  {eventViewTab === 'ordered-list' && (
                    <div className="space-y-8">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <h2 className="text-xl font-bold text-zinc-900">Lista Ordenada</h2>
                          <p className="text-zinc-500 text-sm">Arraste para reordenar a lista de embarque</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={sendPDFToCaptain}
                            disabled={!people.some(p => p.isCaptain)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all shadow-lg font-bold text-sm ${
                              people.some(p => p.isCaptain)
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-100'
                              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                            }`}
                          >
                            <MessageCircle className="w-4 h-4" />
                            Enviar ao Capitão
                          </button>
                          <button
                            onClick={generateOrderedPDF}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 font-bold text-sm"
                          >
                            <FileDown className="w-4 h-4" />
                            Gerar PDF
                          </button>
                        </div>
                      </div>

                      {people.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-zinc-300">
                          <List className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
                          <p className="text-zinc-500 text-sm">Nenhuma pessoa para ordenar.</p>
                        </div>
                      ) : (
                        <Reorder.Group
                          axis="y"
                          values={people}
                          onReorder={updatePeopleOrder}
                          className="space-y-3"
                        >
                          {people.map((person, index) => (
                            <Reorder.Item
                              key={person.id}
                              value={person}
                              className="bg-white p-4 rounded-2xl shadow-sm border border-zinc-200 flex items-center gap-4 cursor-grab active:cursor-grabbing hover:border-indigo-200 transition-colors"
                            >
                              <div className="flex items-center justify-center w-8 h-8 bg-indigo-50 text-indigo-600 rounded-full font-bold text-sm shrink-0">
                                {index + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-zinc-900 truncate">{person.name}</h3>
                                <p className="text-zinc-500 text-xs">{person.phone}</p>
                              </div>
                              <div className="text-zinc-300">
                                <GripVertical className="w-5 h-5" />
                              </div>
                            </Reorder.Item>
                          ))}
                        </Reorder.Group>
                        )
                      }
                    </div>
                  )}
                </div>
              </motion.div>
        )
      )}

      {activeTab === 'people' && (
            <motion.div
              key="people"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-zinc-900">Pessoas Confirmadas</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setImportEventId('');
                          setShowImportModal(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-all text-xs font-bold"
                      >
                        <FileUp className="w-3.5 h-3.5" />
                        Importar
                      </button>
                      <button
                        onClick={() => {
                          setEditingPersonId(null);
                          setPersonFormData({ name: '', phone: '', isCaptain: false, eventId: selectedEventId || '' });
                          setShowPersonForm(true);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-all text-xs font-bold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Novo Passageiro
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {showPersonSuccess && (
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
                {people.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-zinc-300">
                    <Users className="w-10 h-10 text-zinc-300 mx-auto mb-3" />
                    <p className="text-zinc-500 text-sm">Nenhuma pessoa cadastrada.</p>
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
                                <span className="bg-indigo-100 text-indigo-700 text-[7px] md:text-[9px] font-black uppercase px-1 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                                  <Shield className="w-2 h-2 md:w-2.5 h-2.5" />
                                  Capitão
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] md:text-sm text-zinc-500">
                              <div className="flex items-center gap-1.5">
                                <Phone className="w-3 h-3 md:w-3.5 h-3.5" />
                                {person.phone}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 md:w-3.5 h-3.5" />
                                {events.find(e => e.id === person.eventId)?.name || 'Sem evento'}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1 md:gap-2 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditPerson(person)}
                            className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                            title="Editar pessoa"
                          >
                            <Edit2 className="w-4 h-4 md:w-5 h-5" />
                          </button>
                          <button
                            onClick={() => deletePerson(person.id)}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Remover pessoa"
                          >
                            <Trash2 className="w-4 h-4 md:w-5 h-5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
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
        {(activeTab === 'people' || (activeTab === 'events' && selectedEventId && eventViewTab === 'people')) && (
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

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    Salvar Configurações
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
